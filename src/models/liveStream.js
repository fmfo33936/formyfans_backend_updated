const mongoose = require("mongoose");

const liveStreamSchema = new mongoose.Schema(
  {
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    streamType: {
      type: String,
      enum: ["own", "collaborative"],
      default: "own",
      required: true,
    },
    deal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deal",
      default: null,
    },
    coHost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    category: {
      type: String,
      trim: true,
      maxlength: 50,
      default: "General",
    },
    roomName: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["live", "ended"],
      default: "live",
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: Date,
    
    fanbugTotalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    fanbugTotalCents: {
      type: Number,
      default: 0,
      min: 0,
    },
    fanbugCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: "live_streams",
  },
);

liveStreamSchema.index({ status: 1, startedAt: -1 });

module.exports = mongoose.model("LiveStream", liveStreamSchema);
