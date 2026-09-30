const mongoose = require("mongoose");

const aiGenerationSchema = new mongoose.Schema(
  {
    contentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AIContent",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["IMAGE", "VIDEO", "VIDEO_EDIT"],
      required: true,
      index: true,
    },
    prompt: {
      type: String,
      required: true,
      trim: true,
    },
    refinedPrompt: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    resultUrl: {
      type: String,
      trim: true,
    },
    resultS3Key: {
      type: String,
      trim: true,
    },
    reservedCredits: {
      type: Number,
      default: 0,
      min: 0,
    },
    finalCreditsDeducted: {
      type: Number,
      default: 0,
      min: 0,
    },
    provider: {
      type: String,
      default: "magica",
    },
    providerRunId: {
      type: String,
      trim: true,
      index: true,
    },
    providerStatus: {
      type: String,
      trim: true,
    },
    errorMessage: {
      type: String,
      trim: true,
    },
    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    references: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    completedAt: {
      type: Date,
    },
    startedAt: { type: Date },
    failedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

aiGenerationSchema.index({ userId: 1, status: 1, createdAt: -1 });
aiGenerationSchema.index({ status: 1, createdAt: 1 });
aiGenerationSchema.index({ userId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("AIGeneration", aiGenerationSchema);
