const mongoose = require("mongoose");

const mediaItemSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    mediaType: {
      type: String,
      enum: ["image", "video", "gif"],
      required: true,
    },
  },
  { _id: false },
);

const postSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    // What kind of content this is - matters when the post fulfills a deal
    // deliverable ("post" | "reel" | "stream"). OPTIONAL: defaults to "post"
    // for a normal, non-collaborative post.
    contentType: {
      type: String,
      enum: ["post", "reel"],
      default: "post",
    },

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

    // Media content of the post

    media: { type: [mediaItemSchema], default: [] },
    title: { type: String },
    caption: { type: String, trim: true, default: "" },
    tags: { type: [String] },

    // Users tagged in this post (Facebook-style "with X")
    taggedUsers: {
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

    likesCount: { type: Number, default: 0, min: 0 },
    commentsCount: { type: Number, default: 0, min: 0 },
    sharesCount: { type: Number, default: 0, min: 0 },
    impressionsCount: { type: Number, default: 0, min: 0 },
    reachCount: { type: Number, default: 0, min: 0 },

    visibility: {
      type: String,
      enum: ["public", "followers", "private", "exclusive"],
      default: "public",
    },
    // Exclusive content
    isExclusive: { type: Boolean, default: false, index: true },

    // ---- Soft delete fields ----
    // isDeleted: { type: Boolean, default: false, index: true },
    // deletedAt: { type: Date, default: null },

    // ---- Scheduling fields ----
    status: {
      type: String,
      enum: ["draft", "scheduled", "published", "failed"],
      default: "published",
      index: true,
    },
    scheduledAt: { type: Date, default: null, index: true },
    publishedAt: { type: Date, default: null },

    // Boost marker. The authenticated finalize endpoint sets this only after
    // Stripe confirms the payment; the webhook never updates Post fields.
    boostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "boosts",
      default: null,
      index: true,
    },
    isBoosted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ "collaborators.userId": 1, createdAt: -1 });
postSchema.index({ "taggedUsers.userId": 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });

postSchema.index({ status: 1, scheduledAt: 1 });

// // ---- Query helper: default hidden posts exclude ----
// postSchema.query.notDeleted = function () {
//   return this.where({ isDeleted: false });
// };

// // ---- Instance method: soft delete ----
// postSchema.methods.softDelete = function () {
//   this.isDeleted = true;
//   this.deletedAt = new Date();
//   return this.save();
// };

// // ---- Instance method: restore ----
// postSchema.methods.restore = function () {
//   this.isDeleted = false;
//   this.deletedAt = null;
//   return this.save();
// };

module.exports = mongoose.model("posts", postSchema);
