const mongoose = require("mongoose");

const creditPricingSchema = new mongoose.Schema(
  {
    planName: {
      type: String,
      default: "Unlock AI Premium Feature",
      trim: true,
    },
    planDescription: {
      type: String,
      default: "Get access to create high-quality videos with AI. Choose a subscription plan that fits your needs and start creating today.",
      trim: true,
    },
    pricePerCredit: {
      type: Number,
      required: true,
      default: 0.1999, // 100 credits = $19.99
      min: 0.001,
    },
    defaultCredits: {
      type: Number,
      default: 100,
      min: 1,
    },
    minCredits: {
      type: Number,
      default: 10,
      min: 1,
    },
    maxCredits: {
      type: Number,
      default: 10000,
    },
    features: {
      type: [String],
      default: [
        "AI Video Generation",
        "AI Image Generation",
        "AI Video Editing",
      ],
    },
    // Model usage platform credit conversions
    openaiInputCreditsPer1kTokens: {
      type: Number,
      required: true,
      default: 1,
      min: 0.1,
    },
    openaiOutputCreditsPer1kTokens: {
      type: Number,
      required: true,
      default: 3,
      min: 0.1,
    },
    magicaCreditMultiplier: {
      type: Number,
      required: true,
      default: 50,
      min: 1,
    },
    profitMarginMultiplier: {
      type: Number,
      required: true,
      default: 1.3,
      min: 1.0,
    },
    imageReservationCredits: {
      type: Number,
      required: true,
      default: 10,
      min: 1,
    },
    videoReservationCredits: {
      type: Number,
      required: true,
      default: 50,
      min: 1,
    },
    videoEditReservationCredits: {
      type: Number,
      required: true,
      default: 60,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

creditPricingSchema.statics.getActivePricing = async function () {
  let pricing = await this.findOne({ isActive: true }).sort({ updatedAt: -1 });
  if (!pricing) {
    pricing = await this.create({
      planName: "Unlock AI Premium Feature",
      pricePerCredit: 0.1999,
      defaultCredits: 100,
      minCredits: 10,
      isActive: true,
    });
  }
  return pricing;
};

module.exports = mongoose.model("CreditPricing", creditPricingSchema);
