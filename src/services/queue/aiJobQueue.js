const AIGeneration = require("../../models/AIGeneration");
const AIContent = require("../../models/AIContent");
const AIUsage = require("../../models/AIUsage");
const creditService = require("../credits/creditService");
const openaiService = require("../ai/openaiService");
const magicaService = require("../ai/magicaService");
const s3MediaService = require("../s3/s3MediaService");
const logger = require("../../utils/logger");

const safeEmitToUser = (userId, event, data) => {
  try {
    const socketModule = require("../../socket/socket");
    if (socketModule && typeof socketModule.emitToUser === "function") {
      socketModule.emitToUser(userId, event, data);
    }
  } catch (err) {
    logger.warn(`[Queue] Socket emit skipped: ${err.message}`);
  }
};

class AIJobQueue {
  constructor() {
    this.concurrency = 2;
    this.activeJobs = 0;
    this.queue = [];
  }

  /**
   * Enqueues an AI generation job to be processed in the background.
   */
  enqueue(generationId) {
    this.queue.push(generationId.toString());
    setImmediate(() => this._processNext());
  }

  async _processNext() {
    if (this.activeJobs >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const generationId = this.queue.shift();
    this.activeJobs++;

    try {
      await this._executeGenerationJob(generationId);
    } catch (error) {
      logger.error(`Error processing AI job ${generationId}: ${error.message}`);
    } finally {
      this.activeJobs--;
      setImmediate(() => this._processNext());
    }
  }

  async _executeGenerationJob(generationId) {
    const generation = await AIGeneration.findById(generationId);
    if (!generation || generation.status !== "PENDING") {
      return;
    }

    // Mark as PROCESSING
    generation.status = "PROCESSING";
    generation.progress = 10;
    await generation.save();

    const { userId, type, prompt, settings = {}, references = {}, reservedCredits } = generation;

    safeEmitToUser(userId, "ai:generation_progress", {
      generationId: generation._id,
      type,
      status: "processing",
      progress: 10,
      message: `Starting ${type.toLowerCase()} generation process...`,
    });

    try {
      // Step 1: Prompt check / optimization
      let promptResult = {
        refinedPrompt: generation.refinedPrompt || prompt,
        model: "gpt-4o-mini",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        providerCost: 0,
      };

      if (!generation.refinedPrompt) {
        generation.progress = 20;
        await generation.save();

        safeEmitToUser(userId, "ai:generation_progress", {
          generationId: generation._id,
          type,
          status: "processing",
          progress: 20,
          message: "Refining prompt with AI for optimal visual quality...",
        });

        promptResult = await openaiService.refinePrompt({
          userPrompt: prompt,
          generationType: type,
          settings,
          references,
        });

        generation.refinedPrompt = promptResult.refinedPrompt;
      }

      generation.progress = 40;
      await generation.save();

      safeEmitToUser(userId, "ai:generation_progress", {
        generationId: generation._id,
        type,
        status: "processing",
        progress: 40,
        message: "Preparing assets and reference media...",
      });

      // Step 2: Handle private S3 media references for VIDEO_EDIT or Image-to-Video
      let videoUrl = references.videoReference;
      let imageUrl = references.imageReference;

      if (videoUrl) {
        videoUrl = await s3MediaService.createPresignedReadUrl({
          fileKey: videoUrl,
          expiresIn: 3600,
        });
      }

      if (imageUrl) {
        imageUrl = await s3MediaService.createPresignedReadUrl({
          fileKey: imageUrl,
          expiresIn: 3600,
        });
      }

      // Step 3: Call Magica Provider
      generation.progress = 60;
      await generation.save();

      safeEmitToUser(userId, "ai:generation_progress", {
        generationId: generation._id,
        type,
        status: "processing",
        progress: 60,
        message: `Rendering ${type.toLowerCase()} with AI diffusion engine...`,
      });

      let magicaResult;
      if (type === "IMAGE") {
        magicaResult = await magicaService.generateImage({
          prompt: generation.refinedPrompt || prompt,
          resolution: settings.resolution,
          aspectRatio: settings.aspectRatio,
        });
      } else if (type === "VIDEO") {
        magicaResult = await magicaService.generateVideo({
          prompt: generation.refinedPrompt || prompt,
          resolution: settings.resolution,
          aspectRatio: settings.aspectRatio,
          duration: settings.duration,
          audio: settings.audio,
        });
      } else if (type === "VIDEO_EDIT") {
        magicaResult = await magicaService.editVideo({
          prompt: generation.refinedPrompt || references.videoModificationPrompt || prompt,
          videoUrl,
          imageUrl,
          audio: settings.audio,
        });
      }

      // Step 3.5: Download Magica Output and Save Permanently to S3
      generation.progress = 85;
      await generation.save();

      safeEmitToUser(userId, "ai:generation_progress", {
        generationId: generation._id,
        type,
        status: "processing",
        progress: 85,
        message: "Finalizing and preparing your media...",
      });

      const s3Saved = await s3MediaService.downloadAndSaveToS3({
        sourceUrl: magicaResult.mediaUrl,
        userId,
        generationId: generation._id,
        type,
      });

      // Permanent clean S3 URL (short & direct without query parameters)
      const finalMediaUrl = s3Saved?.s3Url || s3Saved?.presignedReadUrl || magicaResult.mediaUrl;
      const finalS3Key = s3Saved?.s3Key || null;

      // Step 4: Track usage
      const finalCreditsDeducted = await creditService.calculatePlatformCredits({
        openaiUsage: promptResult.usage,
        magicaUsage: magicaResult,
        generationType: type,
      });

      // Save OpenAI usage log if tokens were consumed
      if (promptResult.usage?.totalTokens > 0) {
        await AIUsage.create({
          userId,
          generationId: generation._id,
          provider: "openai",
          model: promptResult.model,
          inputTokens: promptResult.usage.inputTokens,
          outputTokens: promptResult.usage.outputTokens,
          totalTokens: promptResult.usage.totalTokens,
          providerCost: promptResult.providerCost,
          platformCredits: 0,
          status: "COMPLETED",
        });
      }

      // Save Magica usage log
      await AIUsage.create({
        userId,
        generationId: generation._id,
        provider: "magica",
        providerRequestId: magicaResult.runId,
        generationType: type,
        providerUsage: magicaResult.creditUsed,
        providerCost: 0,
        platformCredits: finalCreditsDeducted,
        status: "COMPLETED",
        rawResponse: magicaResult.rawResponse,
      });

      // Step 5: Finalize credit deduction and release any excess reservation
      await creditService.finalizeDeduction(
        userId,
        reservedCredits,
        finalCreditsDeducted,
        generation._id,
        `AI ${type} Generation: ${(generation.refinedPrompt || prompt).substring(0, 40)}...`
      );

      // Step 6: Mark generation as COMPLETED with permanent clean S3 URL
      const typeLabel = type === "VIDEO_EDIT" ? "edited video" : type.toLowerCase();
      const friendlySuccessMsg = `Your AI ${typeLabel} is ready!`;

      generation.status = "COMPLETED";
      generation.progress = 100;
      generation.resultUrl = finalMediaUrl;
      generation.resultS3Key = finalS3Key;
      generation.providerRunId = magicaResult.runId;
      generation.providerStatus = "COMPLETED";
      generation.finalCreditsDeducted = finalCreditsDeducted;
      generation.completedAt = new Date();
      generation.metadata = {
        ...generation.metadata,
        magica: magicaResult,
        openai: promptResult,
        s3: s3Saved,
      };

      await generation.save();

      // Permanently update parent AIContent record
      if (generation.contentId) {
        await AIContent.findByIdAndUpdate(generation.contentId, {
          mediaUrl: finalMediaUrl,
          s3Key: finalS3Key,
          status: "COMPLETED",
        });
      }

      // Push real-time completion event to specific user via Socket.io
      safeEmitToUser(userId, "ai:generation_completed", {
        generationId: generation._id,
        contentId: generation.contentId,
        type,
        status: "completed",
        progress: 100,
        mediaUrl: finalMediaUrl,
        s3Key: finalS3Key,
        creditsDeducted: finalCreditsDeducted,
        message: friendlySuccessMsg,
        completedAt: generation.completedAt,
      });

      logger.info(`AI Generation ${generation._id} (${type}) completed. Direct S3 URL: ${finalMediaUrl}`);
    } catch (error) {
      logger.error(`AI Generation ${generation._id} failed: ${error.message}`);

      // Auto-refund/release reserved credits
      try {
        await creditService.refundCredits(
          userId,
          reservedCredits,
          generation._id,
          error.message || "Generation processing failed"
        );
      } catch (refundErr) {
        logger.error(`Failed to refund credits for generation ${generation._id}: ${refundErr.message}`);
      }

      const typeLabel = type === "VIDEO_EDIT" ? "edited video" : type.toLowerCase();
      generation.status = "FAILED";
      generation.progress = 0;
      generation.errorMessage = `We couldn't generate your ${typeLabel} right now. All ${reservedCredits} reserved credits have been refunded to your account.`;
      await generation.save();

      if (generation.contentId) {
        await AIContent.findByIdAndUpdate(generation.contentId, {
          status: "FAILED",
        });
      }

      // Push real-time failure notification to user via Socket.io
      safeEmitToUser(userId, "ai:generation_failed", {
        generationId: generation._id,
        contentId: generation.contentId,
        type,
        status: "failed",
        progress: 0,
        creditsRefunded: reservedCredits,
        message: generation.errorMessage,
      });
    }
  }
}

module.exports = new AIJobQueue();
