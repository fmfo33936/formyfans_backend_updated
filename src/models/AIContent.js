const mongoose = require("mongoose");

const aiContentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: "Untitled AI Project",
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
    currentRefinedPrompt: {
      type: String,
      trim: true,
    },
    settings: {
      resolution: { type: String, trim: true, default: "720p" },
      aspectRatio: { type: String, trim: true, default: "16:9" },
      duration: { type: Number, default: 10 },
      audio: { type: Boolean, default: true },
    },
    references: {
      videoReference: { type: String, trim: true },
      imageReference: { type: String, trim: true },
      videoModificationPrompt: { type: String, trim: true },
    },
    generationsCount: {
      type: Number,
      default: 0,
    },
    latestGenerationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AIGeneration",
    },
    mediaUrl: {
      type: String,
      trim: true,
    },
    s3Key: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

aiContentSchema.index({ userId: 1, createdAt: -1 });
aiContentSchema.index({ userId: 1, s3Key: 1 });
aiContentSchema.index({ userId: 1, mediaUrl: 1 });

module.exports = mongoose.model("AIContent", aiContentSchema);
