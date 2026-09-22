const mongoose = require("mongoose");

const creditTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    transactionType: {
      type: String,
      enum: ["PURCHASE", "RESERVATION", "DEDUCTION", "REFUND", "ADJUSTMENT"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    relatedGeneration: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AIGeneration",
      index: true,
    },
    relatedPayment: {
      type: String,
      trim: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", "CANCELLED"],
      default: "COMPLETED",
      index: true,
    },
    description: {
      type: String,
      trim: true,
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

creditTransactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("CreditTransaction", creditTransactionSchema);
