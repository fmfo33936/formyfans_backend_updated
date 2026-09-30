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
      default: 0.1, // 100 credits = $10.00 (1 credit = $0.10)
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
        "Prompt refinements",
      ],
    },
    // Model usage platform credit conversions
    openaiInputCreditsPer1kTokens: {
      type: Number,
      required: true,
      default: 0.5,
      min: 0.1,
    },
    openaiOutputCreditsPer1kTokens: {
      type: Number,
      required: true,
      default: 1.0,
      min: 0.1,
    },
    magicaCreditMultiplier: {
      type: Number,
      required: true,
      default: 10,
      min: 1,
    },
    profitMarginMultiplier: {
      type: Number,
      required: true,
      default: 2.0, // 100% profit margin / 2x markup ($0.50 cost -> $1.00 charge)
      min: 1.0,
    },
    imageReservationCredits: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    videoReservationCredits: {
      type: Number,
      required: true,
      default: 5,
      min: 1,
    },
    videoEditReservationCredits: {
      type: Number,
      required: true,
      default: 6,
      min: 1,
    },
    reservationSafetyMultiplier: {
      type: Number,
      required: true,
      default: 2,
      min: 1,
      max: 10,
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
    pricing = await this.findOneAndUpdate(
      { isActive: true },
      { $setOnInsert: { planName: "Unlock AI Premium Feature",
        pricePerCredit: 0.1, defaultCredits: 100, minCredits: 10,
        profitMarginMultiplier: 2.0, magicaCreditMultiplier: 10,
        videoReservationCredits: 5, videoEditReservationCredits: 6,
        imageReservationCredits: 1, reservationSafetyMultiplier: 2,
        openaiInputCreditsPer1kTokens: 0.5,
        openaiOutputCreditsPer1kTokens: 1.0, isActive: true } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  }
  return pricing;
};

module.exports = mongoose.model("CreditPricing", creditPricingSchema);
