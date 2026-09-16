const mongoose = require("mongoose");

const postAnalyticsSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "posts",
      required: true,
    },
    // Daily bucket — one document per post per day
    dateOnly: { type: Date, required: true },
    reach: { type: Number, default: 0, min: 0 },
    impressions: { type: Number, default: 0, min: 0 },
    likes: { type: Number, default: 0, min: 0 },
    comments: { type: Number, default: 0, min: 0 },
    shares: { type: Number, default: 0, min: 0 },
  },
  { timestamps: false },
);

// One record per post per day
postAnalyticsSchema.index({ postId: 1, dateOnly: 1 }, { unique: true });
postAnalyticsSchema.index({ postId: 1 });

module.exports = mongoose.model("postAnalytics", postAnalyticsSchema);
