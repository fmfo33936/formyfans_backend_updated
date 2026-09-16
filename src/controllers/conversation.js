const Conversation = require("../models/conversation");
const BoostAnalytics = require("../models/boostAnalytics");

const createConversation = async (req, res) => {
  const user = req.user;
  const participantId = req.body.participantId;
  const io = req.app.get("socketio");

  const conversation = await Conversation.findOne({
    participants: { $all: [user._id, participantId] },
  })
    .sort({ lastUpdated: -1 })
    .populate([
      {
        path: "participants",
        select: "_id image firstName lastName email",
      },
    ]);

  if (conversation) {
    const conObj = {
      ...conversation.toObject(),
      lastMessage: {
        ...conversation.lastMessage.toObject(),
        createdAt: new Date(),
      },
    };

    const updatedConversation = await Conversation.findByIdAndUpdate(
      conversation._id,
      { lastMessage: conObj.lastMessage, lastUpdated: new Date() },
      { new: true, runValidators: true },
    ).populate([
      {
        path: "participants",
        select: "_id image firstName lastName email designation",
      },
    ]);

    return res.status(200).json({
      status: "success",
      data: updatedConversation,
      message: "Conversation already exists",
    });
  }

  const payload = {
    participants: [user._id, participantId],
    conversationId: `${user._id}_${participantId}`,
    lastMessage: {
      message: req.body.message || "Welcome to the conversation",
      sender: user._id,
      createdAt: new Date(),
    },
    lastUpdated: new Date(),
    messagesCount: 0,
    unreadMessagesCount: new Map([
      [participantId, 1],
      [user._id, 0],
    ]),
  };

  const newConversation = await Conversation.create(payload);
  const populatedConversation = await newConversation.populate([
    {
      path: "participants",
      select: "_id image firstName lastName",
    },
  ]);
  io.to(`user_${participantId}`).emit(
    "new_conversation",
    populatedConversation,
  );

  // Track messagesSent for boosted posts (messages objective)
  if (req.body.boostId) {
    BoostAnalytics.findOneAndUpdate(
      { boostId: req.body.boostId },
      { $inc: { messagesSent: 1 } },
    ).catch(() => {});
  }

  res.status(200).json({
    status: "success",
    data: populatedConversation,
    message: "Conversation created successfully",
  });
};

const getConversationByUserId = async (req, res) => {
  const { search } = req.query;
  const user = req.user;

  const conversations = await Conversation.find({ participants: user._id })
    .sort({ lastUpdated: -1 })
    .populate([
      {
        path: "participants",
        select: "_id image firstName lastName email role",
      },
    ]);

  res.status(200).json({
    status: "success",
    data: conversations,
    message: "Conversations fetched successfully",
  });
};

module.exports = {
  createConversation,
  getConversationByUserId,
};
