const mongoose = require("mongoose");

const liveStreamCommentSchema = new mongoose.Schema(
  {
    stream: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveStream",
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    type: {
      type: String,
      enum: ["text", "fanbug"],
      default: "text",
    },
    fanbugAmount: {
      type: Number,
      default: null,
    },
    fanbugMessage: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    fanbugPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveStreamPayment",
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "live_stream_comments",
  },
);

liveStreamCommentSchema.index({ stream: 1, createdAt: -1 });

module.exports = mongoose.model(
  "LiveStreamComment",
  liveStreamCommentSchema,
);
