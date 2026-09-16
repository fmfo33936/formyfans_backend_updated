const mongoose = require("mongoose");
const {
  INTERESTS,
  GENDER,
  ACCOUNT_TYPE,
  ACCOUNT_STATUS,
  ROLE,
} = require("../constants");

const AuthSchema = new mongoose.Schema(
  {
    image: { type: String },
    coverImage: { type: String },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    username: { type: String, unique: true, lowercase: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phoneNumber: { type: String, trim: true, default: "", index: true },
    tagLine: { type: String, trim: true },
    bio: { type: String, trim: true },
    interests: { type: [String] },
    interests: {
      type: [String],
      enum: Object.values(INTERESTS),
      required: true,
    },
    gender: {
      type: String,
      enum: Object.values(GENDER),
      default: "prefer_not_to_say",
    },
    dateOfBirth: { type: Date, required: true },

    password: { type: String, required: true, select: false },

    role: { type: String, enum: Object.values(ROLE), default: "user" },
    status: {
      type: String,
      enum: Object.values(ACCOUNT_STATUS),
      default: "active",
    },
    isVerified: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    lastSeen: { type: Date },

    // Stats (denormalized)
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    postsCount: { type: Number, default: 0 },
    photosCount: { type: Number, default: 0 },
    videosCount: { type: Number, default: 0 },

    // Account settings
    accountType: {
      type: String,
      enum: Object.values(ACCOUNT_TYPE),
      default: "personal",
    },
    isPrivate: { type: Boolean, default: false },

    // Stripe
    stripeCustomerId: { type: String, default: null },
    stripeConnectAccountId: { type: String, default: null },
    activeSubscriptionId: { type: String, default: null },
    activeSubscriptionExpiresAt: { type: Date, default: null },

    // Internal users
    isInternalUser: { type: Boolean, default: false },

    // Admin-created free access
    isAdminCreator: { type: Boolean, default: false },
    freeMonthsExpireAt: { type: Date, default: null },

    // Token versioning for forced logout
    tokenVersion: { type: Number, default: 0 },

    // Rating and Reviews

    rating: {
      average: {
        type: Number,
        default: 0,
      },
      totalReviews: {
        type: Number,
        default: 0,
      },
    },

    // Adult check

    isAdult: {
      type: Boolean,
      required: true,
      default: false,
    },

    // location

    location: {
      type: {
        type: String,
        enum: ["Point"],
        // default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true },
    },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

AuthSchema.index({ interests: 1 });
AuthSchema.index({ location: "2dsphere" });

AuthSchema.methods.addRating = function (newRating, session) {
  const currentAverage = this.rating?.average || 0;
  const currentTotalReviews = this.rating?.totalReviews || 0;

  const updatedTotalReviews = currentTotalReviews + 1;

  const updatedAverage =
    (currentAverage * currentTotalReviews + newRating) / updatedTotalReviews;

  this.rating.average = Number(updatedAverage.toFixed(2));
  this.rating.totalReviews = updatedTotalReviews;

  return this.save(session ? { session } : undefined);
};

module.exports = mongoose.model("users", AuthSchema);
