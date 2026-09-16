// models/fanSubscription.js
const mongoose = require("mongoose");

const fanSubscriptionSchema = new mongoose.Schema(
  {
    fanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },

    stripeSubscriptionId: { type: String, required: true, unique: true },
    stripeCustomerId: { type: String, required: true },
    stripePriceId: { type: String, required: true },

    price: { type: Number, required: true },

    status: {
      type: String,
      enum: ["incomplete", "active", "past_due", "canceled", "unpaid"],
      default: "incomplete",
    },

    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },

    cancelAtPeriodEnd: { type: Boolean, default: false },
    canceledAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "fans_subscription" },
);

fanSubscriptionSchema.index({ fanId: 1, creatorId: 1 });

module.exports = mongoose.model("FanSubscription", fanSubscriptionSchema);
