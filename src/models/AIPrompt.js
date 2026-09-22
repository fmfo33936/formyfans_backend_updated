const mongoose = require("mongoose");

const aiPromptSchema = new mongoose.Schema(
  {
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
    originalPrompt: {
      type: String,
      required: true,
      trim: true,
    },
    refinedPrompt: {
      type: String,
      required: true,
      trim: true,
    },
    style: {
      type: String,
      trim: true,
      default: "Cinematic, High Quality",
    },
    settings: {
      resolution: { type: String, default: "720p" },
      aspectRatio: { type: String, default: "16:9" },
      duration: { type: Number, default: 10 },
      audio: { type: Boolean, default: true },
    },
    references: {
      videoReference: { type: String, trim: true },
      imageReference: { type: String, trim: true },
      videoModificationPrompt: { type: String, trim: true },
    },
    status: {
      type: String,
      enum: ["DRAFT", "ACTIVE", "USED"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
  }
);

aiPromptSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("AIPrompt", aiPromptSchema);
