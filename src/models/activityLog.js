// models/ActivityLog.js
const mongoose = require("mongoose");

const ActivityLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    action: {
      type: String,
      enum: [
        // Auth
        "register",
        "login",
        "logout",
        "password_changed",
        // Profile
        "profile_updated",
        "avatar_updated",
        "cover_updated",
        // Posts
        "post_created",
        "post_scheduled",
        "post_published",
        "post_updated",
        "post_deleted",
        "post_liked",
        "post_unliked",
        "post_shared",
        // Campaigns
        "campaign_liked",
        "campaign_unliked",
        "campaign_shared",
        // Media
        "photo_uploaded",
        "video_uploaded",
        "media_deleted",
        // Follow
        "followed_user",
        "unfollowed_user",
        // Comments
        "comment_added",
        "comment_deleted",
        // Account
        "account_deactivated",
        "account_deleted",
        // Favourite
        "favourite_added",
        "favourite_removed",
        // Exclusive content
        "exclusive_content_created",
        "exclusive_content_updated",
        "exclusive_content_deleted",
      ],
      required: true,
    },

    targetType: {
      type: String,
      enum: ["users", "posts", "media", "comments", "favourites", "campaigns", null],
      default: null,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    ipAddress: { type: String },
    userAgent: { type: String },
  },
  {
    timestamps: true,
    collection: "activity_logs",
  },
);

ActivityLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 },
);

module.exports = mongoose.model("activity_logs", ActivityLogSchema);
