const mongoose = require("mongoose");

const liveStreamPaymentSchema = new mongoose.Schema(
  {
    stream: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveStream",
      required: true,
      index: true,
    },
    payer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    coHost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },

    amount: { type: Number, required: true },
    amountInCents: { type: Number, required: true },
    stripeFee: { type: Number, default: 0 },
    stripeFeeInCents: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    netAmountInCents: { type: Number, default: 0 },
    currency: { type: String, default: "usd" },

    stripePaymentIntentId: {
      type: String,
      required: true,
      unique: true,
    },

    message: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },

    paidAt: {
      type: Date,
      default: Date.now,
    },

    isPayoutDone: {
      type: Boolean,
      default: false,
      index: true,
    },
    payoutAmount: {
      type: Number,
      default: 0,
    },
    payoutAt: {
      type: Date,
      default: null,
    },
    transferId: {
      type: String,
      default: null,
    },

  },
  {
    timestamps: true,
    collection: "live_stream_payments",
  },
);

liveStreamPaymentSchema.index({ stream: 1, createdAt: -1 });
liveStreamPaymentSchema.index({ creator: 1, createdAt: -1 });

module.exports = mongoose.model(
  "LiveStreamPayment",
  liveStreamPaymentSchema,
);
