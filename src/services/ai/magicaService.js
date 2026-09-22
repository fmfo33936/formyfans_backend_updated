const axios = require("axios");
const logger = require("../../utils/logger");

class MagicaService {
  constructor() {
    this.apiKey = process.env.MAGICA_API_KEY;
    this.baseUrl = (process.env.MAGICA_BASE_URL || "https://inference.magica.com/v1").replace(/\/+$/, "");

    // Models & Node types
    this.imageNodeType = process.env.MAGICA_IMAGE_MODEL_NODE_TYPE || "flux_2_max";
    this.textImageSubmodel = process.env.MAGICA_TEXT_IMAGE_SUBMODEL || "flux-2-max-text";
    this.imageOutputFormat = process.env.MAGICA_IMAGE_OUTPUT_FORMAT || "JPEG";

    this.videoNodeType = process.env.MAGICA_VIDEO_MODEL_NODE_TYPE || "seedance_2_0_fast";
    this.textVideoSubmodel = process.env.MAGICA_TEXT_VIDEO_SUBMODEL || "seedance-2.0-fast-text-to-video";

    this.videoEditNodeType = process.env.MAGICA_VIDEO_EDIT_MODEL_NODE_TYPE || "kling_o3_pro_video_edit";

    this.pollIntervalMs = Number(process.env.MAGICA_POLL_INTERVAL_MS) || 3000;
    this.timeoutMs = Number(process.env.MAGICA_TIMEOUT_MS) || 900000; // 15 mins
  }

  get isConfigured() {
    return Boolean(this.apiKey && !this.apiKey.startsWith("demo_") && this.apiKey.length > 10);
  }

  /**
   * Generates Image from prompt using Magica Image node.
   */
  async generateImage({ prompt, resolution = "1080p", aspectRatio = "16:9" }) {
    if (!this.isConfigured) {
      logger.warn("Magica API key not configured or using demo key. Simulating image generation for development.");
      return this._simulateGeneration("IMAGE", { prompt, resolution, aspectRatio });
    }

    const inputPayload = {
      prompt,
      num_images: 1,
      image_size: this._normalizeImageSize(resolution, aspectRatio),
      output_format: this.imageOutputFormat,
    };

    const run = await this._startRunAndWait({
      nodeType: this.imageNodeType,
      submodelId: this.textImageSubmodel,
      inputPayload,
    });

    const mediaUrl = this._extractMediaUrl(run.output);
    if (!mediaUrl) {
      throw new Error(`Magica did not return an image URL for run ${run.id || run.runId}`);
    }

    return {
      mediaUrl,
      creditUsed: Number(run.creditUsed || 0.1),
      runId: run.id || run.runId,
      provider: "magica",
      nodeType: this.imageNodeType,
      rawResponse: run,
    };
  }

  /**
   * Generates Video from prompt using Magica Video node.
   */
  async generateVideo({ prompt, resolution = "720p", aspectRatio = "16:9", duration = 10, audio = true }) {
    if (!this.isConfigured) {
      logger.warn("Magica API key not configured or using demo key. Simulating video generation for development.");
      return this._simulateGeneration("VIDEO", { prompt, resolution, aspectRatio, duration, audio });
    }

    const inputPayload = {
      prompt,
      duration: Number(duration) || 10,
      aspect_ratio: aspectRatio || "16:9",
      resolution: resolution || "720p",
      generate_audio: Boolean(audio),
    };

    const run = await this._startRunAndWait({
      nodeType: this.videoNodeType,
      submodelId: this.textVideoSubmodel,
      inputPayload,
    });

    const mediaUrl = this._extractMediaUrl(run.output);
    if (!mediaUrl) {
      throw new Error(`Magica did not return a video URL for run ${run.id || run.runId}`);
    }

    return {
      mediaUrl,
      creditUsed: Number(run.creditUsed || 0.5),
      runId: run.id || run.runId,
      provider: "magica",
      nodeType: this.videoNodeType,
      rawResponse: run,
    };
  }

  /**
   * Edits Video from prompt + presigned video URL using Magica Video Edit node.
   */
  async editVideo({ prompt, videoUrl, imageUrl = null, audio = true }) {
    if (!videoUrl) {
      throw new Error("videoUrl is required for video editing.");
    }

    if (!this.isConfigured) {
      logger.warn("Magica API key not configured or using demo key. Simulating video edit for development.");
      return this._simulateGeneration("VIDEO_EDIT", { prompt, videoUrl, imageUrl, audio });
    }

    const inputPayload = {
      video_url: videoUrl,
      prompt: prompt || "",
      keep_audio: Boolean(audio),
    };

    if (imageUrl) {
      inputPayload.image_urls = [imageUrl];
    }

    const run = await this._startRunAndWait({
      nodeType: this.videoEditNodeType,
      submodelId: null,
      inputPayload,
    });

    const mediaUrl = this._extractMediaUrl(run.output);
    if (!mediaUrl) {
      throw new Error(`Magica did not return an edited video URL for run ${run.id || run.runId}`);
    }

    return {
      mediaUrl,
      creditUsed: Number(run.creditUsed || 0.6),
      runId: run.id || run.runId,
      provider: "magica",
      nodeType: this.videoEditNodeType,
      rawResponse: run,
    };
  }

  /**
   * Submits run request and polls until COMPLETED or FAILED.
   */
  async _startRunAndWait({ nodeType, submodelId, inputPayload }) {
    const runBody = { input: inputPayload };
    if (submodelId) {
      runBody.subModelId = submodelId;
    }

    // Start run
    const startRes = await axios.post(`${this.baseUrl}/nodes/${nodeType}/run`, runBody, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "User-Agent": "FormyFansAI/1.0",
      },
      timeout: 60000,
    });

    const runId = startRes.data?.runId || startRes.data?.id;
    if (!runId) {
      throw new Error("Magica did not return a runId in start response.");
    }

    // Polling loop
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const pollRes = await axios.get(`${this.baseUrl}/nodes/runs/${runId}`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": "FormyFansAI/1.0",
        },
        timeout: 30000,
      });

      const run = pollRes.data;
      const status = String(run.status || "").toUpperCase();

      if (status === "COMPLETED") {
        return run;
      }

      if (status === "FAILED" || status === "CANCELED") {
        const errDetail = run.error || run.userMessage || "Unknown provider error";
        throw new Error(`Magica run ${runId} ended with ${status}: ${errDetail}`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    throw new Error(`Magica run ${runId} timed out after ${this.timeoutMs / 1000}s`);
  }

  _normalizeImageSize(resolution, aspectRatio) {
    const cleanAspect = (aspectRatio || "").trim();
    if (["1:1", "4:3", "3:4", "16:9", "9:16"].includes(cleanAspect)) {
      return cleanAspect;
    }

    const cleanRes = (resolution || "").trim().toLowerCase();
    const map = {
      "480p": { width: 854, height: 480 },
      "720p": { width: 1280, height: 720 },
      "1080p": { width: 1920, height: 1080 },
    };

    return map[cleanRes] || "16:9";
  }

  _extractMediaUrl(output) {
    if (!output) return null;
    if (typeof output === "string" && output.startsWith("http")) return output;
    if (Array.isArray(output)) {
      for (const item of output) {
        const found = this._extractMediaUrl(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof output === "object") {
      for (const key of ["video_url", "image_url", "url", "file_url", "content_url"]) {
        if (output[key] && typeof output[key] === "string" && output[key].startsWith("http")) {
          return output[key];
        }
      }
      for (const key of ["video", "videos", "output", "data", "result", "media"]) {
        const found = this._extractMediaUrl(output[key]);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Demo simulator for development environments without active Magica keys.
   */
  async _simulateGeneration(type, params) {
    await new Promise((resolve) => setTimeout(resolve, 1500)); // simulate latency
    const mockId = `mock_magica_${Date.now()}`;
    const mediaUrls = {
      IMAGE: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80",
      VIDEO: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
      VIDEO_EDIT: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    };

    return {
      mediaUrl: mediaUrls[type] || mediaUrls.IMAGE,
      creditUsed: type === "IMAGE" ? 0.08 : 0.45,
      runId: mockId,
      provider: "magica",
      nodeType: type === "IMAGE" ? this.imageNodeType : type === "VIDEO" ? this.videoNodeType : this.videoEditNodeType,
      rawResponse: { id: mockId, status: "COMPLETED", simulated: true, params },
    };
  }
}

module.exports = new MagicaService();
