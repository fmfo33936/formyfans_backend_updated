const axios = require("axios");
const logger = require("../../utils/logger");

class MagicaService {
  constructor() {
    this._apiKey = process.env.MAGICA_API_KEY;
    this._baseUrl = process.env.MAGICA_BASE_URL;

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

  get apiKey() {
    return process.env.MAGICA_API_KEY || this._apiKey;
  }

  get baseUrl() {
    return (process.env.MAGICA_BASE_URL || this._baseUrl || "https://inference.magica.com/v1").replace(/\/+$/, "");
  }

  get isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Generates Image from prompt using Magica Image node.
   */
  async generateImage({ prompt, resolution = "1080p", aspectRatio = "16:9" }) {
    if (!this.isConfigured) {
      throw new Error("Magica API key is not configured. Please set MAGICA_API_KEY in your environment.");
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
      creditUsed: Number(run.creditUsed || 0),
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
      throw new Error("Magica API key is not configured. Please set MAGICA_API_KEY in your environment.");
    }

    const inputPayload = {
      prompt,
      duration: this._normalizeVideoDuration(duration),
      aspect_ratio: aspectRatio || "16:9",
      resolution: this._normalizeVideoResolution(resolution),
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
      creditUsed: Number(run.creditUsed || 0),
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
      throw new Error("Magica API key is not configured. Please set MAGICA_API_KEY in your environment.");
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
      creditUsed: Number(run.creditUsed || 0),
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
    let startRes;
    try {
      startRes = await axios.post(`${this.baseUrl}/nodes/${nodeType}/run`, runBody, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": "FormyFansAI/1.0",
        },
        timeout: 60000,
      });
    } catch (err) {
      const errDetails = this._extractErrorMessage(err);
      logger.error(`Magica start run failed for node '${nodeType}': ${errDetails}`);
      throw new Error(`Magica API error (${err.response?.status || 500}): ${errDetails}`);
    }

    const runId = startRes.data?.runId || startRes.data?.id;
    if (!runId) {
      throw new Error("Magica did not return a runId in start response.");
    }

    // Polling loop
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      let pollRes;
      try {
        pollRes = await axios.get(`${this.baseUrl}/nodes/runs/${runId}`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": "FormyFansAI/1.0",
          },
          timeout: 30000,
        });
      } catch (pollErr) {
        // If client error (4xx) like 401 Unauthorized or 404, throw exact error immediately
        const statusCode = pollErr.response?.status;
        if (statusCode && statusCode >= 400 && statusCode < 500) {
          const detail = this._extractErrorMessage(pollErr);
          throw new Error(`Magica polling failed (${statusCode}): ${detail}`);
        }
        // Transient network/5xx glitch: log and retry polling until timeout
        logger.warn(`Transient polling error for run ${runId}: ${pollErr.message}`);
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        continue;
      }

      const run = pollRes.data;
      const status = String(run.status || "").toUpperCase();

      if (status === "COMPLETED") {
        return run;
      }

      if (status === "FAILED" || status === "CANCELED") {
        let errDetail = "";
        if (run.error) {
          if (typeof run.error === "object") {
            errDetail = run.error.message || run.error.detail || JSON.stringify(run.error);
          } else {
            errDetail = String(run.error);
          }
        } else if (run.userMessage) {
          errDetail = String(run.userMessage);
        } else {
          errDetail = `Provider returned status: ${status}`;
        }
        throw new Error(`Magica generation ${status.toLowerCase()}: ${errDetail}`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    throw new Error(`Magica run ${runId} timed out after ${this.timeoutMs / 1000}s`);
  }

  _extractErrorMessage(err) {
    if (!err) return "Unknown error";
    if (err.response?.data) {
      const data = err.response.data;
      if (typeof data === "string") {
        return data.includes("<html")
          ? `${err.response.status} ${err.response.statusText || "Service Error"}`
          : data;
      }
      if (typeof data === "object") {
        return data.message || data.error || data.detail || data.userMessage || JSON.stringify(data);
      }
    }
    return err.message || "Unknown error";
  }

  _normalizeVideoResolution(resolution) {
    const clean = (resolution || "720p").trim().toLowerCase();
    if (!["480p", "720p"].includes(clean)) {
      throw new Error(`Invalid video resolution '${resolution}'. Magica video only supports exact values: '480p' or '720p'.`);
    }
    return clean;
  }

  _normalizeVideoDuration(duration) {
    const num = Number(duration || 10);
    if (![5, 10, 15].includes(num)) {
      throw new Error(`Invalid video duration '${duration}'. Magica video only supports exact values: 5, 10, or 15 seconds.`);
    }
    return num;
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
}

module.exports = new MagicaService();
