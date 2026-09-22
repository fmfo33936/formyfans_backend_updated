const mongoose = require("mongoose");

const userCreditSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    reserved: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    totalPurchased: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

userCreditSchema.virtual("availableBalance").get(function () {
  return Math.max(0, this.balance - this.reserved);
});

userCreditSchema.set("toJSON", { virtuals: true });
userCreditSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("UserCredit", userCreditSchema);
