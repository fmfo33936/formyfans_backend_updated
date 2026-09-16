const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },

    type: {
      type: String,
      enum: [
        "followed",
        "favourited",
        "post_liked",
        "post_commented",
        "post_shared",
        "post_tagged",
        "comment_mentioned",
        "campaign_liked",
        "campaign_commented",
        "campaign_shared",
        "deal_created",
        "deal_accepted",
        "deal_rejected",
        "deal_started",
        "deal_completion_requested",
        "deal_completed",
        "deal_incomplete",
        "deal_cancelled",
        "deal_paused",
        "deal_resumed",
        "system",
      ],
      required: true,
      index: true,
    },

    targetType: {
      type: String,
      enum: [
        "users",
        "likes",
        "comments",
        "favourites",
        "follows",
        "posts",
        "campaigns",
        "deals",
        null,
      ],
      default: null,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    title: { type: String, trim: true, default: "" },
    message: { type: String, trim: true, default: "" },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "notifications",
  },
);

NotificationSchema.index({ recipientId: 1, createdAt: -1 });

NotificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

NotificationSchema.index(
  { recipientId: 1, senderId: 1, type: 1, targetId: 1 },
  {
    unique: true,
    partialFilterExpression: { targetId: { $type: "objectId" } },
  },
);

// auto-delete after 7 days
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 },
);

module.exports = mongoose.model("notifications", NotificationSchema);
