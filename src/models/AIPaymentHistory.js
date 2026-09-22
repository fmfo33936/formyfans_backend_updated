const mongoose = require("mongoose");

const aiPaymentHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    stripePaymentIntentId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    stripeCustomerId: {
      type: String,
      trim: true,
    },
    planName: {
      type: String,
      default: "Unlock AI Premium Feature",
      trim: true,
    },
    creditsPurchased: {
      type: Number,
      required: true,
      min: 1,
    },
    amountPaidUsd: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed"],
      default: "pending",
      index: true,
    },
    paidAt: {
      type: Date,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

aiPaymentHistorySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("AIPaymentHistory", aiPaymentHistorySchema);
