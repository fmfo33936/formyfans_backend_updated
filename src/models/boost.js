const mongoose = require("mongoose");

// NOTE: refs point at the registered model names in this codebase
// ("posts", "users"), not at a model named "Post"/"User" — Mongoose wraps
// $lookup-style populate using the registered model name.
const boostSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "posts",
      required: true,
      index: true,
    },
    // The creator who owns the boosted post (from the post's authorId).
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    // The logged-in user actually paying to boost the post.
    advertiserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    objective: {
      type: String,
      enum: ["engagement", "profile", "messages", "website"],
      required: true,
    },
    websiteUrl: {
      type: String,
      // Only required/relevant when the objective is "website". Uses a
      // custom validator instead of `required: true` so it stays optional
      // for every other objective but is enforced here.
      validate: {
        validator: function (value) {
          if (this.objective !== "website") return true;
          return typeof value === "string" && value.trim().length > 0;
        },
        message:
          "websiteUrl is required when the objective is 'website'.",
      },
    },
    audienceMode: {
      type: String,
      enum: ["automatic", "custom"],
      required: true,
    },
    audience: {
      countries: { type: [String], default: [] },
      ageRange: {
        min: { type: Number, default: 18 },
        max: { type: Number, default: 65 },
      },
      interests: { type: [String], default: [] },
    },
    duration: {
      type: Number,
      enum: [3, 7, 14],
      required: true,
    },
    budget: {
      type: Number,
      required: true,
      min: 10,
    },
    // Total budget spread across the boost duration: budget / duration.
    perDayBudget: {
      type: Number,
      default: 0,
    },
    estimatedReach: {
      low: { type: Number, default: 0 },
      high: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ["pending", "active", "completed", "failed", "cancelled"],
      default: "pending",
    },
    stripePaymentIntentId: { type: String },
    stripeCustomerId: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
  },
  { timestamps: true },
);

boostSchema.index({ advertiserId: 1, status: 1 });
boostSchema.index({ postId: 1 });
boostSchema.index({ status: 1, endDate: 1 });
boostSchema.index({ stripePaymentIntentId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("boosts", boostSchema);
