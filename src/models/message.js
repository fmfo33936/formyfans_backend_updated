const mongoose = require("mongoose");

const sharedPostSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "posts",
    },
    caption: { type: String },
    media: {
      url: { type: String },
      mediaType: {
        type: String,
        enum: ["image", "video", "gif"],
      },
    },
  },
  { _id: false },
);

const sharedDealSchema = new mongoose.Schema(
  {
    dealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deal",
    },
    title: { type: String },
    brand: { type: String },
    description: { type: String },
    amount: { type: Number },
    currency: { type: String },
    paymentType: {
      type: String,
      enum: ["one-time", "monthly", "split"],
    },
    deliverables: [
      {
        type: {
          type: String,
          enum: ["post", "reel", "stream","story"],
        },
        count: { type: Number },
      },
    ],
    deadline: { type: Date },
    status: { type: String },
    paymentStatus: { type: String },
    hasReview: { type: Boolean, default: false }
  },
  { _id: false },
);

const sharedCampaignSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
    },
    brand: { type: String },
    name: { type: String },
    description: { type: String },
    advertisement: {
      headline: { type: String },
      primaryText: { type: String },
      callToAction: { type: String },
      designationUrl: { type: String },
      media: [
        {
          url: { type: String },
          mediaType: {
            type: String,
            enum: ["image", "video"],
          },
        },
      ],
    },
    endDateTime: { type: Date },
  },
  { _id: false },
);

const MessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: String,
      required: true,
      ref: "Conversation",
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "users",
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "users",
    },
    message: {
      type: String,
      default: "",
    },
    attachment: {
      url: { type: String },
      type: {
        type: String,
        enum: ["image", "file", "audio"],
      },
      name: { type: String },
      size: { type: Number },
    },
    sharedPost: {
      type: sharedPostSchema,
    },
    sharedDeal: {
      type: sharedDealSchema,
    },
    sharedCampaign: {
      type: sharedCampaignSchema,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "messages",
    timestamps: true,
  },
);

const Message = mongoose.model("Message", MessageSchema);
module.exports = Message;
