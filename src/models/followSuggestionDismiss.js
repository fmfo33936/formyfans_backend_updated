const mongoose = require("mongoose");

const FollowSuggestionDismissSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    dismissedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
  },
  { timestamps: true, collection: "followSuggestionDismisses" },
);

FollowSuggestionDismissSchema.index(
  { userId: 1, dismissedUserId: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  "followSuggestionDismiss",
  FollowSuggestionDismissSchema,
);
