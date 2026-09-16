const mongoose = require("mongoose");

const boostAnalyticsSchema = new mongoose.Schema(
  {
    boostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "boosts",
      required: true,
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "posts",
      required: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    objective: {
      type: String,
      enum: ["engagement", "profile", "messages", "website"],
      required: true,
    },
    totalReach: { type: Number, default: 0, min: 0 },
    totalImpressions: { type: Number, default: 0, min: 0 },
    totalLikes: { type: Number, default: 0, min: 0 },
    totalComments: { type: Number, default: 0, min: 0 },
    totalShares: { type: Number, default: 0, min: 0 },
    profileVisits: { type: Number, default: 0, min: 0 },
    messagesSent: { type: Number, default: 0, min: 0 },
    websiteClicks: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// One record per boost — lifetime totals
boostAnalyticsSchema.index({ boostId: 1 }, { unique: true });
boostAnalyticsSchema.index({ creatorId: 1 });
boostAnalyticsSchema.index({ postId: 1 });

module.exports = mongoose.model("boostAnalytics", boostAnalyticsSchema);
