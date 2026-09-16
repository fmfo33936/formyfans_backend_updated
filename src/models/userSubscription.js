const mongoose = require("mongoose");

const userSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
    },
    stripeCustomerId: {
      type: String,
      required: true,
    },
    stripeSubscriptionId: {
      type: String,
      default: null,
    },
    stripePriceId: {
      type: String,
      default: null,
    },
    plan: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "incomplete",
        "incomplete_expired",
        "expired",
        "cancelled",
      ],
      default: "incomplete",
    },
    price: Number,
    trialStart: { type: Date, default: null },
    trialEnd: { type: Date, default: null },

    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },

    cancelAtPeriodEnd: { type: Boolean, default: false },
    canceledAt: { type: Date, default: null },

    hasDiscountApplied: { type: Boolean, default: false },

    // startDate: {
    //     type: Date,
    //     default: Date.now
    // },
    // endDate: {
    //     type: Date,
    //     required: true
    // },

    paymentId: String, // Stripe / payment reference
  },
  { timestamps: true },
);

module.exports = mongoose.model("userSubscriptions", userSubscriptionSchema);
