const AIContent = require("../../models/AIContent");
const AIGeneration = require("../../models/AIGeneration");
const AIPrompt = require("../../models/AIPrompt");
const creditService = require("../credits/creditService");
const aiJobQueue = require("../queue/aiJobQueue");
const generationMessages = require("./generationMessages");

class AIGenerationService {
  /**
   * Initializes generation, reserves credits, and enqueues background processing.
   */
  async createGeneration({
    userId,
    contentId,
    replaceOriginal = false,
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
    // Strict exact validation (no loose normalization)
    const isVideo = type === "VIDEO" || type === "VIDEO_EDIT";
    if (isVideo && resolution && !["480p", "720p"].includes(resolution)) {
      throw new Error(`Invalid resolution '${resolution}' for video. Magica only accepts exact values: '480p' or '720p'.`);
    }
    if (isVideo && duration && ![5, 10, 15].includes(Number(duration))) {
      throw new Error(`Invalid duration '${duration}' for video. Magica only accepts exact values: 5, 10, or 15 seconds.`);
    }
    if (type === "IMAGE" && resolution && !["480p", "720p", "1080p"].includes(resolution)) {
      throw new Error(`Invalid resolution '${resolution}' for image. Supported values: '480p', '720p', '1080p'.`);
    }

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
      duration: isVideo ? Number(duration || 10) : undefined,
      audio: isVideo ? (audio !== undefined ? Boolean(audio) : true) : undefined,
    };

    const references = {
      videoReference,
      imageReference,
      videoModificationPrompt,
    };

    // 3. Create or link AIContent parent project
    let content = null;
    let oldS3Key = null;

    if (contentId) {
      content = await AIContent.findOne({ _id: contentId, userId });
    }
    // Auto-detect existing project if videoReference matches an existing project
    if (!content && videoReference) {
      content = await AIContent.findOne({
        userId,
        $or: [{ s3Key: videoReference }, { mediaUrl: videoReference }],
      });
    }

    if (content) {
      oldS3Key = content.s3Key;
      content.generationsCount = (content.generationsCount || 1) + 1;
      content.type = type;
      if (finalPrompt) content.prompt = finalPrompt;
      if (finalRefinedPrompt) content.currentRefinedPrompt = finalRefinedPrompt;
      content.settings = settings;
      content.references = references;
      content.status = "PROCESSING";
      await content.save();
    } else {
      content = await AIContent.create({
        userId,
        title: (finalPrompt || "AI Content").substring(0, 50),
        type,
        prompt: finalPrompt,
        currentRefinedPrompt: finalRefinedPrompt || undefined,
        settings,
        references,
        status: "PROCESSING",
      });
    }

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
      metadata: {
        replaceOriginal: Boolean(replaceOriginal),
        oldS3Key: oldS3Key || undefined,
      },
    });

    content.latestGenerationId = generation._id;
    await content.save();

    // 5. Reserve credits atomically
    try {
      await creditService.reserveCredits(userId, requiredReservation, generation._id);
    } catch (error) {
      generation.status = "FAILED";
      generation.progress = 0;
      generation.errorMessage = error.message;
      await generation.save();
      await AIContent.updateOne(
        { _id: content._id, latestGenerationId: generation._id },
        { $set: { status: "FAILED" } }
      );
      throw error;
    }

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
      message: generationMessages.forType(type).start,
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
    let friendlyMessage = generationMessages.forProgress(generation.type, generation.progress);
    if (isCompleted) {
      friendlyMessage = generationMessages.forType(generation.type).done;
    } else if (isFailed) {
      friendlyMessage = generationMessages.forType(generation.type).failed;
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
      error: isFailed ? friendlyMessage : null,
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
        error: isFailed ? generationMessages.forType(gen.type).failed : null,
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
