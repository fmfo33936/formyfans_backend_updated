const mongoose = require("mongoose");

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const storySchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    media: { type: String, trim: true, required: true },
    mediaType: { type: String, enum: ["image", "video"], required: true },
    // Collaborative posts can be associated with a deal, but it's OPTIONAL.
    // Stays null for every regular ("Own") post.
    dealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deal",
      default: null,
    },

    // OPTIONAL: empty array by default. Only gets an entry (the deal's
    // sender) when the post is created against a deal - see createPost.
    collaborators: {
      type: [
        {
          userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: true,
          },
        },
      ],
      default: [],
    },
    
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    },
  },
  {
    timestamps: true,
    collection: "stories",
  },
);

storySchema.index({ authorId: 1, expiresAt: -1 });
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("stories", storySchema);
