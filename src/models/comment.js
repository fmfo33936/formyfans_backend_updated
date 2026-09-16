const mongoose = require("mongoose");

const ENGAGEMENT_TARGET_TYPES = ["post", "campaign"];

const commentSchema = new mongoose.Schema(
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
    // Kept for backward compatibility with existing post comments
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "posts",
      index: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    content: { type: String, required: true, trim: true },
    mentions: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "users" }],
      default: [],
    },
  },
  { timestamps: true },
);

commentSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
commentSchema.index({ postId: 1, createdAt: -1 });

module.exports = mongoose.model("comments", commentSchema);
module.exports.ENGAGEMENT_TARGET_TYPES = ENGAGEMENT_TARGET_TYPES;
