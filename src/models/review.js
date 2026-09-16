const mongoose = require("mongoose");
const { Schema } = mongoose;

const REVIEW_TARGET = {
  DEAL: "deal",
};

const reviewSchema = new Schema(
  {
    reviewer: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },

    reviewee: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },

    targetType: {
      type: String,
      enum: Object.values(REVIEW_TARGET),
      required: true,
    },

    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },

    comment: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
    collection: "reviews",
  }
);

// Prevent duplicate review for same target
reviewSchema.index(
  {
    reviewer: 1,
    targetType: 1,
    targetId: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model("Review", reviewSchema);
module.exports.REVIEW_TARGET = REVIEW_TARGET;