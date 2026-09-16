const mongoose = require("mongoose");

const storyViewSchema = new mongoose.Schema(
  {
    storyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "stories",
      required: true,
    },
    viewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    viewedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

storyViewSchema.index({ storyId: 1, viewerId: 1 }, { unique: true });

module.exports = mongoose.model("storyViews", storyViewSchema);
