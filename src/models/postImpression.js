const mongoose = require("mongoose");

const postImpressionSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "posts",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    firstViewedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

postImpressionSchema.index({ postId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("postImpressions", postImpressionSchema);
