const mongoose = require("mongoose");

const ENGAGEMENT_TARGET_TYPES = ["post", "campaign"];

const ShareSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: ENGAGEMENT_TARGET_TYPES,
      default: "post",
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    // Kept for backward compatibility with existing post shares
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "posts",
      index: true,
    },
    sharedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: "users" }],
  },
  { timestamps: true, collection: "shares" },
);

ShareSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model("shares", ShareSchema);
module.exports.ENGAGEMENT_TARGET_TYPES = ENGAGEMENT_TARGET_TYPES;
