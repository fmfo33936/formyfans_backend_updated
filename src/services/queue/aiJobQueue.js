const { Queue, Worker } = require("bullmq");
const mongoose = require("mongoose");
const AIGeneration = require("../../models/AIGeneration");
const AIContent = require("../../models/AIContent");
const AIUsage = require("../../models/AIUsage");
const creditService = require("../credits/creditService");
const openaiService = require("../ai/openaiService");
const magicaService = require("../ai/magicaService");
const s3MediaService = require("../s3/s3MediaService");
const logger = require("../../utils/logger");
const generationMessages = require("../ai/generationMessages");
const { createRedisConnection } = require("../../config/redis");

const QUEUE_NAME = "ai-generation";

const emitToUser = (userId, event, data) => {
  try {
    require("../../socket/socket").emitToUser?.(userId, event, data);
  } catch (error) {
    logger.warn(`[AI Queue] Socket emit skipped: ${error.message}`);
  }
};

class AIJobQueue {
  initialize() {
    if (this.queue && this.worker) return;
    this.queueConnection = createRedisConnection("ai-queue");
    this.workerConnection = createRedisConnection("ai-worker", { blocking: true });
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.queueConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 5000 },
      },
    });
    this.worker = new Worker(
      QUEUE_NAME,
      (job) => this._execute(job),
      {
        connection: this.workerConnection,
        concurrency: Math.max(1, Number(process.env.AI_QUEUE_CONCURRENCY) || 100),
        limiter: {
          max: Math.max(1, Number(process.env.AI_PROVIDER_START_RATE_PER_MINUTE) || 100),
          duration: 60000,
        },
        lockDuration: Math.max(60000, Number(process.env.AI_JOB_LOCK_DURATION_MS) || 1200000),
      }
    );
    this.worker.on("failed", (job, error) => logger.error(`[AI Queue] Job ${job?.id} failed: ${error.message}`));
    this.worker.on("error", (error) => logger.error(`[AI Worker] ${error.message}`));
  }

  async enqueue(generationId) {
    this.initialize();
    const id = generationId.toString();
    await this.queue.add("generate", { generationId: id }, { jobId: id });
  }

  async recoverOnStartup() {
    this.initialize();
    await Promise.race([
      this.queue.waitUntilReady(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis queue connection timed out")), 10000)),
    ]);
    let lastId = null;
    let recovered = 0;
    while (true) {
      const filter = { status: { $in: ["PENDING", "PROCESSING"] } };
      if (lastId) filter._id = { $gt: lastId };
      const batch = await AIGeneration.find(filter).sort({ _id: 1 }).limit(500).select("_id").lean();
      if (!batch.length) break;
      await this.queue.addBulk(batch.map(({ _id }) => ({
        name: "generate",
        data: { generationId: _id.toString() },
        opts: { jobId: _id.toString() },
      })));
      recovered += batch.length;
      lastId = batch[batch.length - 1]._id;
    }
    logger.info(`[AI Queue] Recovered ${recovered} unfinished generation(s).`);
  }

  async close() {
    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.queueConnection?.quit();
  }

  async _progress(generationId, progress) {
    await AIGeneration.updateOne({ _id: generationId, status: "PROCESSING" }, { $set: { progress } });
  }

  async _execute(job) {
    const generationId = job.data.generationId;
    const generation = await AIGeneration.findOneAndUpdate(
      { _id: generationId, status: { $in: ["PENDING", "PROCESSING"] } },
      { $set: { status: "PROCESSING", progress: 10, startedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!generation) return;

    const { userId, type, prompt, settings = {}, references = {}, reservedCredits } = generation;
    const messages = generationMessages.forType(type);
    emitToUser(userId, "ai:generation_progress", {
      generationId: generation._id, type, status: "processing", progress: 10, message: messages.start,
    });

    let savedOutputKey = null;
    try {
      let promptResult = {
        refinedPrompt: generation.refinedPrompt || prompt,
        model: "gpt-4o-mini",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        providerCost: 0,
      };
      if (!generation.refinedPrompt) {
        await this._progress(generation._id, 20);
        emitToUser(userId, "ai:generation_progress", {
          generationId: generation._id, type, status: "processing", progress: 20, message: messages.refine,
        });
        promptResult = await openaiService.refinePrompt({
          userPrompt: prompt, generationType: type, settings, references,
        });
        generation.refinedPrompt = promptResult.refinedPrompt;
        await AIGeneration.updateOne(
          { _id: generation._id, status: "PROCESSING" },
          { $set: { refinedPrompt: generation.refinedPrompt } }
        );
      }

      await this._progress(generation._id, 40);
      emitToUser(userId, "ai:generation_progress", {
        generationId: generation._id, type, status: "processing", progress: 40, message: messages.prepare,
      });

      let videoUrl = references.videoReference;
      let imageUrl = references.imageReference;
      if (videoUrl) videoUrl = await s3MediaService.createPresignedReadUrl({ fileKey: videoUrl, expiresIn: 3600 });
      if (imageUrl) imageUrl = await s3MediaService.createPresignedReadUrl({ fileKey: imageUrl, expiresIn: 3600 });

      await this._progress(generation._id, 60);
      emitToUser(userId, "ai:generation_progress", {
        generationId: generation._id, type, status: "processing", progress: 60, message: messages.render,
      });

      let index = 0;
      const timer = setInterval(() => emitToUser(userId, "ai:generation_progress", {
        generationId: generation._id, type, status: "processing", progress: 60,
        message: messages.waiting[index++ % messages.waiting.length],
      }), 15000);

      let providerResult;
      try {
        providerResult = generation.providerRunId
          ? await magicaService.resumeRun({ runId: generation.providerRunId, type })
          : await this._generate(generation, generation.refinedPrompt || prompt, settings, references, videoUrl, imageUrl);
      } finally {
        clearInterval(timer);
      }

      await AIGeneration.updateOne(
        { _id: generation._id, status: "PROCESSING" },
        { $set: { progress: 85, providerRunId: providerResult.runId, providerStatus: "COMPLETED" } }
      );
      emitToUser(userId, "ai:generation_progress", {
        generationId: generation._id, type, status: "processing", progress: 85, message: messages.save,
      });

      const s3Result = await s3MediaService.downloadAndSaveToS3({
        sourceUrl: providerResult.mediaUrl, userId, generationId: generation._id, type,
      });
      savedOutputKey = s3Result?.s3Key || null;
      await this._complete(generation, promptResult, providerResult, s3Result);
    } catch (error) {
      if (savedOutputKey) {
        await s3MediaService.deleteFile(savedOutputKey);
        savedOutputKey = null;
      }
      const retryable = /timed out|timeout|network|ECONNRESET|EAI_AGAIN|5\d\d/i.test(error.message || "");
      if (retryable && job.attemptsMade + 1 < (job.opts.attempts || 1)) {
        await AIGeneration.updateOne(
          { _id: generation._id, status: "PROCESSING" },
          { $set: { status: "PENDING", progress: 60, errorMessage: error.message } }
        );
        throw error;
      }
      await this._fail(generation, error);
    }
  }

  _generate(generation, prompt, settings, references, videoUrl, imageUrl) {
    const { type } = generation;
    const onRunStarted = (runId) => AIGeneration.updateOne(
      { _id: generation._id, status: "PROCESSING" },
      { $set: { providerRunId: runId, providerStatus: "PROCESSING" } }
    );
    if (type === "IMAGE") {
      return magicaService.generateImage({ prompt, resolution: settings.resolution,
        aspectRatio: settings.aspectRatio, onRunStarted });
    }
    if (type === "VIDEO") {
      return magicaService.generateVideo({ prompt, resolution: settings.resolution,
        aspectRatio: settings.aspectRatio, duration: settings.duration, audio: settings.audio, onRunStarted });
    }
    return magicaService.editVideo({
      prompt: prompt || references.videoModificationPrompt, videoUrl, imageUrl,
      audio: settings.audio, onRunStarted,
    });
  }

  async _complete(generation, promptResult, providerResult, s3Result) {
    const finalUrl = s3Result?.s3Url || s3Result?.presignedReadUrl || providerResult.mediaUrl;
    const finalKey = s3Result?.s3Key || null;
    const actualCredits = await creditService.calculatePlatformCredits({
      openaiUsage: promptResult.usage, magicaUsage: providerResult, generationType: generation.type,
    });
    const chargedCredits = Math.min(actualCredits, generation.reservedCredits);
    const completedAt = new Date();

    await mongoose.connection.transaction(async (session) => {
      const usage = [];
      if (promptResult.usage?.totalTokens > 0) {
        usage.push({ userId: generation.userId, generationId: generation._id, provider: "openai",
          model: promptResult.model, inputTokens: promptResult.usage.inputTokens,
          outputTokens: promptResult.usage.outputTokens, totalTokens: promptResult.usage.totalTokens,
          providerCost: promptResult.providerCost, platformCredits: 0, status: "COMPLETED" });
      }
      usage.push({ userId: generation.userId, generationId: generation._id, provider: "magica",
        providerRequestId: providerResult.runId, generationType: generation.type,
        providerUsage: providerResult.creditUsed, providerCost: 0,
        platformCredits: chargedCredits, status: "COMPLETED" });
      await AIUsage.create(usage, { session, ordered: true });
      await creditService.finalizeDeduction(
        generation.userId, generation.reservedCredits, chargedCredits, generation._id,
        `AI ${generation.type} Generation: ${(generation.refinedPrompt || generation.prompt).substring(0, 40)}...`, session
      );
      await AIGeneration.updateOne(
        { _id: generation._id, status: "PROCESSING" },
        { $set: { status: "COMPLETED", progress: 100, refinedPrompt: generation.refinedPrompt,
          resultUrl: finalUrl, resultS3Key: finalKey, providerRunId: providerResult.runId,
          providerStatus: "COMPLETED", finalCreditsDeducted: chargedCredits, completedAt,
          metadata: { ...generation.metadata, actualCalculatedCredits: actualCredits,
            magica: { runId: providerResult.runId, provider: providerResult.provider,
              nodeType: providerResult.nodeType, creditUsed: providerResult.creditUsed },
            openai: promptResult, s3: s3Result } } },
        { session }
      );
      await AIContent.updateOne(
        { _id: generation.contentId, latestGenerationId: generation._id },
        { $set: { mediaUrl: finalUrl, s3Key: finalKey, status: "COMPLETED" } },
        { session }
      );
    });

    const oldKey = generation.metadata?.oldS3Key;
    if (generation.metadata?.replaceOriginal && oldKey && oldKey !== finalKey) {
      await s3MediaService.deleteFile(oldKey);
    }
    emitToUser(generation.userId, "ai:generation_completed", {
      generationId: generation._id, contentId: generation.contentId, type: generation.type,
      status: "completed", progress: 100, mediaUrl: finalUrl, s3Key: finalKey,
      creditsDeducted: chargedCredits, message: generationMessages.forType(generation.type).done, completedAt,
    });
  }

  async _fail(generation, error) {
    const exactError = error.message || "Generation processing failed";
    logger.error(`[AI Queue] Generation ${generation._id} failed: ${exactError}`);
    let refundedCredits = 0;
    try {
      const refunded = await creditService.refundCredits(
        generation.userId, generation.reservedCredits, generation._id, exactError
      );
      refundedCredits = refunded?.released || 0;
    } catch (refundError) {
      logger.error(`[AI Queue] Refund failed for ${generation._id}: ${refundError.message}`);
    }
    await AIGeneration.updateOne(
      { _id: generation._id, status: "PROCESSING" },
      { $set: { status: "FAILED", progress: 0, errorMessage: exactError, failedAt: new Date() } }
    );
    await AIContent.updateOne(
      { _id: generation.contentId, latestGenerationId: generation._id },
      { $set: { status: "FAILED" } }
    );
    const friendlyError = generationMessages.forType(generation.type).failed;
    emitToUser(generation.userId, "ai:generation_failed", {
      generationId: generation._id, contentId: generation.contentId, type: generation.type,
      status: "failed", progress: 0, creditsRefunded: refundedCredits,
      error: friendlyError, message: friendlyError,
    });
  }
}

module.exports = new AIJobQueue();
