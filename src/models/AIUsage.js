const mongoose = require("mongoose");

const aiUsageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    generationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AIGeneration",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["openai", "magica"],
      required: true,
      index: true,
    },
    // OpenAI specific fields
    model: {
      type: String,
      trim: true,
    },
    inputTokens: {
      type: Number,
      default: 0,
    },
    outputTokens: {
      type: Number,
      default: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
    // Magica specific fields
    providerRequestId: {
      type: String,
      trim: true,
      index: true,
    },
    generationType: {
      type: String,
      trim: true,
    },
    providerUsage: {
      type: Number, // e.g. Magica credits used
      default: 0,
    },
    // Common economics
    providerCost: {
      type: Number, // USD cost incurred by provider
      default: 0,
    },
    platformCredits: {
      type: Number, // converted platform credits charged to user
      default: 0,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED"],
      default: "COMPLETED",
    },
    rawResponse: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

aiUsageSchema.index({ generationId: 1, provider: 1 });

module.exports = mongoose.model("AIUsage", aiUsageSchema);
