const mongoose = require("mongoose");
const { INTERESTS, GENDER } = require("../constants");

const mediaItemSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    mediaType: {
      type: String,
      enum: ["image", "video"],
      required: true,
    },
  },
  { _id: false },
);


const advertisement = new mongoose.Schema({
  media: { type: [mediaItemSchema], default: [] },
  headline: { type: String, required: true, minlength: 2, maxlength: 60 },
  primaryText: { type: String, required: true, minlength: 2, maxlength: 300 },
  callToAction: {
    type: String,
    required: true,
    enum: [
      "shop_now",
      "learn_more",
      "sign_up",
      "book_now",
      "get_offer",
      "download",
      "subscribe",
    ],
  },
  designationUrl: { type: String, required: true },
});

const campaignSchema = new mongoose.Schema(
  {
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    objective: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CampaignObjective",
      required: true,
      index: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CampaignCategory",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
      // unique: true,
    },
    brand: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    description: {
      type: String,
      trim: true,
      minlength: 3,
      maxlength: 300,
    },
    // creators: {
    //   type: [mongoose.Schema.Types.ObjectId],
    //   ref: "users",
    //   required: true,
    // },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
    },
    gender: {
      type: [String],
      enum: Object.values(GENDER),
      required: true,
    },
    ageRange: {
      min: { type: Number, default: 0, min: 0, max: 100 },
      max: { type: Number, default: 100, min: 0, max: 100 },
    },
    interests: {
      type: [String],
      enum: Object.values(INTERESTS),
      required: true,
    },
    budgetType: { type: String, enum: ["daily", "lifetime"], required: true },
    dailyBudget: { type: Number, required: true, min: 1 },
    radiusInKm: { type: Number, default: 50, min: 1, max: 500 },

    launchType: {
      type: String,
      enum: ["immediate", "scheduled"],
      default: "immediate",
      required: true,
    },
    startDateTime: {
      type: Date,
      required: function () {
        return this.launchType === "scheduled";
      },
      validate: {
        validator: function (value) {
          if (this.launchType === "immediate") return true;
          return value > new Date();
        },
        message:
          "Start date/time must be in the future for scheduled campaigns.",
      },
    },
    endDateTime: {
      type: Date,
      required: true,
      validate: {
        validator: function (value) {
          const start =
            this.launchType === "scheduled" ? this.startDateTime : new Date();
          return value > start;
        },
        message: "End date/time must be after the start date/time.",
      },
    },

    // ---- Payment fields ----
    paymentIntentId: { type: String, index: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "disputed"],
      default: "pending",
    },

    advertisement,

    likesCount: { type: Number, default: 0, min: 0 },
    commentsCount: { type: Number, default: 0, min: 0 },
    sharesCount: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ["live", "planning", "wrapping", "refunded"],
      default: "live",
    },
  },
  { timestamps: true, collection: "campaign" },
);

campaignSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Campaign", campaignSchema);
