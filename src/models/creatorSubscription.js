// models/creatorProfile.js
const mongoose = require("mongoose");

const creatorSubscription = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      unique: true,
    },

    subscriptionPrice: { type: Number, default: null }, // dollars

    stripePriceId: { type: String, default: null },

    stripeProductId: { type: String, default: null },

    isSubscriptionActive: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "creator_subscriptions" },
);

module.exports = mongoose.model("CreatorPrice", creatorSubscription);
