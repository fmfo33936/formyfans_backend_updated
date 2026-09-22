const AIContent = require("../../models/AIContent");
const AIGeneration = require("../../models/AIGeneration");
const AIPrompt = require("../../models/AIPrompt");
const creditService = require("../credits/creditService");
const aiJobQueue = require("../queue/aiJobQueue");

class AIGenerationService {
  /**
   * Initializes generation, reserves credits, and enqueues background processing.
   */
  async createGeneration({
    userId,
    type,
    prompt,
    refinedPrompt,
    promptId,
    resolution,
    aspectRatio,
    duration,
    audio,
    videoReference,
    imageReference,
    videoModificationPrompt,
  }) {
    const requiredReservation = await creditService.getRequiredReservationCredits(type);

    // 1. Verify credit availability
    const hasEnough = await creditService.hasSufficientCredits(userId, requiredReservation);
    if (!hasEnough) {
      throw new Error(`Insufficient credits. This ${type.toLowerCase()} generation requires ${requiredReservation} credits.`);
    }

    // 2. Check if a saved prompt was passed
    let finalPrompt = prompt || videoModificationPrompt || "";
    let finalRefinedPrompt = refinedPrompt || "";

    if (promptId) {
      const savedPrompt = await AIPrompt.findOne({ _id: promptId, userId });
      if (savedPrompt) {
        if (!finalPrompt) finalPrompt = savedPrompt.originalPrompt;
        if (!finalRefinedPrompt) finalRefinedPrompt = savedPrompt.refinedPrompt;
        savedPrompt.status = "USED";
        await savedPrompt.save();
      }
    }

    // If refinedPrompt was passed directly as prompt
    if (!finalPrompt && finalRefinedPrompt) {
      finalPrompt = finalRefinedPrompt;
    }

    const settings = {
      resolution: resolution || (type === "IMAGE" ? "1080p" : "720p"),
      aspectRatio: aspectRatio || "16:9",
      duration: duration ? Number(duration) : 10,
      audio: audio !== undefined ? Boolean(audio) : true,
    };

    const references = {
      videoReference,
      imageReference,
      videoModificationPrompt,
    };

    // 3. Create or link AIContent parent project
    const content = await AIContent.create({
      userId,
      title: (finalPrompt || "AI Content").substring(0, 50),
      type,
      prompt: finalPrompt,
      currentRefinedPrompt: finalRefinedPrompt || undefined,
      settings,
      references,
    });

    // 4. Create AIGeneration record
    const generation = await AIGeneration.create({
      contentId: content._id,
      userId,
      type,
      prompt: finalPrompt,
      refinedPrompt: finalRefinedPrompt || undefined,
      status: "PENDING",
      progress: 5,
      reservedCredits: requiredReservation,
      settings,
      references,
    });

    content.latestGenerationId = generation._id;
    content.generationsCount = 1;
    await content.save();

    // 5. Reserve credits atomically
    await creditService.reserveCredits(userId, requiredReservation, generation._id);

    // 6. Enqueue background execution
    aiJobQueue.enqueue(generation._id);

    const estimatedWait = type === "IMAGE" ? 45 : 65;

    return {
      generationId: generation._id,
      contentId: content._id,
      type: generation.type,
      status: "processing",
      progress: 5,
      reservedCredits: generation.reservedCredits,
      prompt: finalRefinedPrompt || finalPrompt,
      message: `Your ${type.toLowerCase()} generation request has been accepted and is being created by AI. Please check back shortly.`,
      estimatedWaitSeconds: estimatedWait,
      createdAt: generation.createdAt,
    };
  }

  /**
   * Fetches single generation status and result with user-friendly formatting.
   */
  async getGeneration(userId, generationId) {
    const generation = await AIGeneration.findOne({
      _id: generationId,
      userId,
    }).populate("contentId", "title type settings references");

    if (!generation) {
      throw new Error("AI Generation not found.");
    }

    const isCompleted = generation.status === "COMPLETED";
    const isFailed = generation.status === "FAILED";
    const isProcessing = generation.status === "PROCESSING" || generation.status === "PENDING";

    let friendlyMessage = "Your AI generation is currently processing. Please check back in a few seconds.";
    if (isCompleted) {
      friendlyMessage = `Your ${generation.type.toLowerCase()} has been generated successfully and saved to your S3 storage!`;
    } else if (isFailed) {
      friendlyMessage = generation.errorMessage || "Generation could not be completed. Your credits have been refunded.";
    }

    return {
      generationId: generation._id,
      type: generation.type,
      status: isCompleted ? "completed" : isFailed ? "failed" : "processing",
      progress: generation.progress,
      mediaUrl: isCompleted ? generation.resultUrl : null,
      s3Key: isCompleted ? generation.resultS3Key : null,
      prompt: generation.refinedPrompt || generation.prompt,
      originalPrompt: generation.prompt,
      creditsDeducted: isCompleted ? generation.finalCreditsDeducted : 0,
      creditsReserved: isProcessing ? generation.reservedCredits : 0,
      message: friendlyMessage,
      createdAt: generation.createdAt,
      completedAt: generation.completedAt,
    };
  }

  /**
   * Lists paginated user generations with user-friendly status.
   */
  async listUserGenerations(userId, { page = 1, limit = 10, type = null }) {
    const filter = { userId };
    if (type) filter.type = type;

    const skip = (page - 1) * limit;
    const [generations, totalCount] = await Promise.all([
      AIGeneration.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-metadata.rawResponse -metadata.magica.rawResponse"),
      AIGeneration.countDocuments(filter),
    ]);

    const formattedGenerations = generations.map((gen) => {
      const isCompleted = gen.status === "COMPLETED";
      const isFailed = gen.status === "FAILED";
      return {
        generationId: gen._id,
        type: gen.type,
        status: isCompleted ? "completed" : isFailed ? "failed" : "processing",
        progress: gen.progress,
        mediaUrl: isCompleted ? gen.resultUrl : null,
        s3Key: isCompleted ? gen.resultS3Key : null,
        prompt: gen.refinedPrompt || gen.prompt,
        creditsDeducted: isCompleted ? gen.finalCreditsDeducted : 0,
        createdAt: gen.createdAt,
        completedAt: gen.completedAt,
      };
    });

    return {
      data: formattedGenerations,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }
}

module.exports = new AIGenerationService();
