const mongoose = require("mongoose");

const ENGAGEMENT_TARGET_TYPES = ["post", "campaign"];

const LikeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
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
    // Kept for backward compatibility with existing post likes
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "posts",
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "likes",
  },
);

LikeSchema.index(
  { userId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);

module.exports = mongoose.model("likes", LikeSchema);
module.exports.ENGAGEMENT_TARGET_TYPES = ENGAGEMENT_TARGET_TYPES;
