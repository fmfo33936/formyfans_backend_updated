const mongoose = require("mongoose");

const paymentHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
    },

    stripeInvoiceId: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },

    planName: { type: String, required: true },

    amountInCents: { type: Number, required: true }, // in cents
    amount: { type: Number, required: true }, // in dollars
    currency: { type: String, default: "usd" },

    // paid, trial_start, failed, refunded
    status: {
      type: String,
      enum: ["trial_start", "paid", "failed", "refunded"],
      required: true,
    },

    description: { type: String, default: "" },

    paidAt: { type: Date, default: null },

    hasDiscountApplied: { type: Boolean, default: false },
    discountPercentage: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentHistory", paymentHistorySchema);