const axios = require("axios");
const logger = require("../../utils/logger");

class OpenAIService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.model = process.env.OPENAI_PROMPT_MODEL || "gpt-4o-mini";
    this.inputPricePer1M = Number(process.env.OPENAI_INPUT_PRICE_PER_1M_TOKENS) || 0.15;
    this.outputPricePer1M = Number(process.env.OPENAI_OUTPUT_PRICE_PER_1M_TOKENS) || 0.60;
  }

  /**
   * Refines and optimizes user prompt for Image, Video, or Video Edit generation.
   */
  async refinePrompt({ userPrompt, generationType = "IMAGE", settings = {}, references = {} }) {
    if (!userPrompt || !userPrompt.trim()) {
      return {
        refinedPrompt: userPrompt,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        model: this.model,
        providerCost: 0,
      };
    }

    // Check if API key is real (not demo/empty)
    const isConfigured = this.apiKey && !this.apiKey.startsWith("demo_") && this.apiKey.length > 20;

    if (!isConfigured) {
      logger.warn("OpenAI API key not configured or using demo key. Using intelligent fallback prompt optimization.");
      return this._fallbackPromptRefinement({ userPrompt, generationType, settings });
    }

    const systemInstruction = generationType === "VIDEO_EDIT"
      ? "You are an AI video editor prompt engineer. Rewrite the user's video edit instruction into a precise production prompt. Strictly preserve the requested edit and do not add unrelated changes. Keep it provider-safe, non-graphic, non-sexual, and free of real-person impersonation. Do not request logos, captions, watermarks, or unrelated new content. Return only valid JSON in this exact shape: {\"refined_prompt\":\"...\"}."
      : "You are an AI media production prompt engineer. Rewrite the user's prompt into a high-quality production prompt for the target AI media model. Keep the user's intent. Improve clarity, visual detail, composition, motion, lighting, camera direction, and constraints where useful. Keep the prompt provider-safe: avoid graphic violence, sexual content, hate, weapons, drugs, celebrity likenesses, copyrighted characters, brand logos, readable text, captions, and watermark requests. If people appear, make them generic and non-identifiable. Return only valid JSON in this exact shape: {\"refined_prompt\":\"...\"}.";

    const userContent = `Generation type: ${generationType}
Settings: ${JSON.stringify(settings)}
References: ${JSON.stringify(references)}
User prompt:
${userPrompt}`;

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: this.model,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
          temperature: 0.6,
          max_tokens: 600,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 30000,
        }
      );

      const usage = response.data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      const totalTokens = usage.total_tokens || inputTokens + outputTokens;

      const providerCost = this._calculateCost(inputTokens, outputTokens);

      const rawContent = response.data?.choices?.[0]?.message?.content || "{}";
      let parsed;
      try {
        parsed = JSON.parse(rawContent);
      } catch (e) {
        parsed = { refined_prompt: userPrompt };
      }

      const refinedPrompt = parsed.refined_prompt || userPrompt;

      return {
        refinedPrompt: refinedPrompt.trim(),
        usage: { inputTokens, outputTokens, totalTokens },
        model: this.model,
        providerCost,
      };
    } catch (error) {
      logger.error(`OpenAI Prompt refinement failed: ${error.response?.data?.error?.message || error.message}. Falling back.`);
      return this._fallbackPromptRefinement({ userPrompt, generationType, settings });
    }
  }

  _calculateCost(inputTokens, outputTokens) {
    const inputCost = (inputTokens / 1000000) * this.inputPricePer1M;
    const outputCost = (outputTokens / 1000000) * this.outputPricePer1M;
    return Number((inputCost + outputCost).toFixed(6));
  }

  _fallbackPromptRefinement({ userPrompt, generationType, settings }) {
    let suffix = "High resolution, cinematic lighting, 8k quality, professional production, realistic textures.";
    if (generationType === "VIDEO") {
      suffix = "Fluid cinematic motion, smooth camera pan, 4k ultra realistic, cinematic depth of field.";
    } else if (generationType === "VIDEO_EDIT") {
      suffix = "Seamless stylistic transition, enhanced lighting and grading, preserving core motion.";
    }

    const refinedPrompt = `${userPrompt.trim()}. ${suffix}`;
    return {
      refinedPrompt,
      usage: { inputTokens: 40, outputTokens: 60, totalTokens: 100 },
      model: `${this.model}-local-fallback`,
      providerCost: 0.00005,
    };
  }
}

module.exports = new OpenAIService();
