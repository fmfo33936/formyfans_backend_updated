const mongoose = require("mongoose");
const AIGeneration = require("../../models/AIGeneration");
const AIContent = require("../../models/AIContent");
const AIUsage = require("../../models/AIUsage");
const CreditTransaction = require("../../models/CreditTransaction");
const creditService = require("../credits/creditService");
const openaiService = require("../ai/openaiService");
const magicaService = require("../ai/magicaService");
const s3MediaService = require("../s3/s3MediaService");
const logger = require("../../utils/logger");
const generationMessages = require("../ai/generationMessages");

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

  async recoverOnStartup() {
    const pending = await AIGeneration.find({ status: "PENDING" }).select("_id");
    for (const generation of pending) {
      const reservation = await CreditTransaction.exists({
        relatedGeneration: generation._id,
        transactionType: "RESERVATION",
        status: "COMPLETED",
      });
      if (reservation) {
        this.enqueue(generation._id);
      } else {
        await AIGeneration.updateOne(
          { _id: generation._id, status: "PENDING" },
          { $set: { status: "FAILED", progress: 0, errorMessage: "Generation was interrupted before credits were reserved." } }
        );
      }
    }

    const interrupted = await AIGeneration.find({ status: "PROCESSING" });
    for (const generation of interrupted) {
      try {
        const message = "Generation interrupted by server restart; please retry.";
        await creditService.refundCredits(
          generation.userId,
          generation.reservedCredits,
          generation._id,
          message
        );
        generation.status = "FAILED";
        generation.progress = 0;
        generation.errorMessage = message;
        await generation.save();
        await AIContent.updateOne(
          { _id: generation.contentId, latestGenerationId: generation._id },
          { $set: { status: "FAILED" } }
        );
      } catch (error) {
        logger.error(`Could not recover AI generation ${generation._id}: ${error.message}`);
      }
    }
    logger.info(`Recovered ${pending.length} pending AI jobs; marked ${interrupted.length} interrupted jobs for review.`);
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

    generation.status = "PROCESSING";
    generation.progress = 10;
    await generation.save();

    const { userId, type, prompt, settings = {}, references = {}, reservedCredits } = generation;

    safeEmitToUser(userId, "ai:generation_progress", {
      generationId: generation._id,
      type,
      status: "processing",
      progress: 10,
      message: generationMessages.forType(type).start,
    });

    try {
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
          message: generationMessages.forType(type).refine,
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
        message: generationMessages.forType(type).prepare,
      });

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

      generation.progress = 60;
      await generation.save();

      safeEmitToUser(userId, "ai:generation_progress", {
        generationId: generation._id,
        type,
        status: "processing",
        progress: 60,
        message: generationMessages.forType(type).render,
      });

      let magicaResult;
      let waitingMessageIndex = 0;
      const waitingMessages = generationMessages.forType(type).waiting;
      const waitingTimer = setInterval(() => {
        safeEmitToUser(userId, "ai:generation_progress", {
          generationId: generation._id,
          type,
          status: "processing",
          progress: 60,
          message: waitingMessages[waitingMessageIndex++ % waitingMessages.length],
        });
      }, 15000);
      try {
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
      } finally {
        clearInterval(waitingTimer);
      }

      generation.progress = 85;
      await generation.save();

      safeEmitToUser(userId, "ai:generation_progress", {
        generationId: generation._id,
        type,
        status: "processing",
        progress: 85,
        message: generationMessages.forType(type).save,
      });

      const s3Saved = await s3MediaService.downloadAndSaveToS3({
        sourceUrl: magicaResult.mediaUrl,
        userId,
        generationId: generation._id,
        type,
      });

      const finalMediaUrl = s3Saved?.s3Url || s3Saved?.presignedReadUrl || magicaResult.mediaUrl;
      const finalS3Key = s3Saved?.s3Key || null;

      const finalCreditsDeducted = await creditService.calculatePlatformCredits({
        openaiUsage: promptResult.usage,
        magicaUsage: magicaResult,
        generationType: type,
      });

      const friendlySuccessMsg = generationMessages.forType(type).done;
      await mongoose.connection.transaction(async (session) => {
        if (promptResult.usage?.totalTokens > 0) {
          await AIUsage.create([{
            userId, generationId: generation._id, provider: "openai",
            model: promptResult.model,
            inputTokens: promptResult.usage.inputTokens,
            outputTokens: promptResult.usage.outputTokens,
            totalTokens: promptResult.usage.totalTokens,
            providerCost: promptResult.providerCost,
            platformCredits: 0,
            status: "COMPLETED",
          }], { session });
        }
        await AIUsage.create([{
          userId, generationId: generation._id, provider: "magica",
          providerRequestId: magicaResult.runId,
          generationType: type,
          providerUsage: magicaResult.creditUsed,
          providerCost: 0,
          platformCredits: finalCreditsDeducted,
          status: "COMPLETED",
        }], { session });

        await creditService.finalizeDeduction(
          userId, reservedCredits, finalCreditsDeducted, generation._id,
          `AI ${type} Generation: ${(generation.refinedPrompt || prompt).substring(0, 40)}...`,
          session
        );

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
          magica: {
            runId: magicaResult.runId,
            provider: magicaResult.provider,
            nodeType: magicaResult.nodeType,
            creditUsed: magicaResult.creditUsed,
          },
          openai: promptResult,
          s3: s3Saved,
        };
        await generation.save({ session });

        await AIContent.updateOne(
          { _id: generation.contentId, latestGenerationId: generation._id },
          { $set: {
            mediaUrl: finalMediaUrl,
            s3Key: finalS3Key,
            status: "COMPLETED",
          } },
          { session }
        );
      });

      const oldKey = generation.metadata?.oldS3Key;
      if (generation.metadata?.replaceOriginal && oldKey && oldKey !== finalS3Key) {
        await s3MediaService.deleteFile(oldKey);
      }

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

      logger.info(`AI generation ${generation._id} (${type}) completed.`);
    } catch (error) {
      const exactErrorMessage = error.message || "Generation processing failed";
      const friendlyErrorMessage = generationMessages.forType(type).failed;
      logger.error(`AI Generation ${generation._id} failed: ${exactErrorMessage}`);

      try {
        await creditService.refundCredits(
          userId,
          reservedCredits,
          generation._id,
          exactErrorMessage
        );
      } catch (refundErr) {
        logger.error(`Failed to refund credits for generation ${generation._id}: ${refundErr.message}`);
      }

      generation.status = "FAILED";
      generation.progress = 0;
      generation.errorMessage = exactErrorMessage;
      await generation.save();

      if (generation.contentId) {
        await AIContent.findByIdAndUpdate(generation.contentId, {
          status: "FAILED",
        });
      }

      safeEmitToUser(userId, "ai:generation_failed", {
        generationId: generation._id,
        contentId: generation.contentId,
        type,
        status: "failed",
        progress: 0,
        creditsRefunded: reservedCredits,
        error: friendlyErrorMessage,
        message: friendlyErrorMessage,
      });
    }
  }
}

module.exports = new AIJobQueue();
