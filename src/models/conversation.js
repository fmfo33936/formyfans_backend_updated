const mongoose = require("mongoose");

const lastMessageSchema = new mongoose.Schema({
  message: { type: String, required: true },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

const ConversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users",
        required: true,
      },
    ],
    conversationId: {
      type: String,
      required: true,
      unique: true,
    },
    lastMessage: lastMessageSchema,

    lastUpdated: {
      type: Date,
      default: Date.now,
    },

    messagesCount: {
      type: Number,
      default: 0,
    },

    unreadMessagesCount: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "conversation",
  },
);

const Conversation = mongoose.model("Conversation", ConversationSchema);
module.exports = Conversation;
