const Deal = require("../models/deal");
const MessageModel = require("../models/message");
const ConversationModel = require("../models/conversation");
const ReviewModel = require("../models/review");
const UserModel = require("../models/auth");
const mongoose = require("mongoose");
const { parsePagination } = require("../utils/socialHelpers");
const {
  createDealSchema,
  dealPaymentSchema,
  dealReviewSchema,
  adminVerifyIncompleteDealSchema,
} = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");
const { dollarsToCents, getStripe } = require("../utils/stripe");
const { createNotification } = require("../utils/notificationHelper");
const stripe = getStripe();

const DEAL_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  STARTED: "started",
  VERIFYING: "verifying",
  COMPLETED: "completed",
  INCOMPLETE: "incomplete",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  PAUSED: "paused",
};


const DEAL_MESSAGE = "Sent a deal";

const getUserName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
  user?.username ||
  "The user";

const notifyDealStatus = async (deal) => {
  const status = deal.status;
  const isResume =
    status === DEAL_STATUS.PENDING && deal.statusHistory?.length > 1;
  const actorId = deal.statusHistory?.[deal.statusHistory.length - 1]?.changedBy;
  const actor = actorId
    ? await UserModel.findById(actorId).select("firstName lastName username")
    : null;
  const actorName = getUserName(actor);
  const isAdminCompletion =
    status === DEAL_STATUS.COMPLETED &&
    actorId &&
    actorId.toString() !== deal.sender.toString();

  const notifications = {
    [DEAL_STATUS.PENDING]: {
      recipientId: deal.receiver,
      type: isResume ? "deal_resumed" : "deal_created",
      message: isResume
        ? `${actorName} resumed your deal`
        : `You have received a new deal from ${actorName}`,
    },
    [DEAL_STATUS.ACCEPTED]: {
      recipientId: deal.sender,
      type: "deal_accepted",
      message: `${actorName} accepted your deal`,
    },
    [DEAL_STATUS.REJECTED]: {
      recipientId: deal.sender,
      type: "deal_rejected",
      message: `${actorName} rejected your deal`,
    },
    [DEAL_STATUS.STARTED]: {
      recipientId: deal.receiver,
      type: "deal_started",
      message: `${actorName} started your deal. You can now begin the work`,
    },
    [DEAL_STATUS.VERIFYING]: {
      recipientId: deal.sender,
      type: "deal_completion_requested",
      message: `${actorName} requested completion of your deal`,
    },
    [DEAL_STATUS.COMPLETED]: {
      recipientId: deal.receiver,
      type: "deal_completed",
      message: isAdminCompletion
        ? "Admin marked your deal as complete"
        : `${actorName} marked your deal as complete`,
    },
    [DEAL_STATUS.INCOMPLETE]: {
      recipientId: deal.receiver,
      type: "deal_incomplete",
      message: `${actorName} marked your deal as incomplete`,
    },
    [DEAL_STATUS.CANCELLED]: {
      recipientId: deal.receiver,
      type: "deal_cancelled",
      message: `${actorName} cancelled your deal`,
    },
    [DEAL_STATUS.PAUSED]: {
      recipientId: deal.receiver,
      type: "deal_paused",
      message: `${actorName} paused your deal`,
    },
  }[status];

  if (!notifications) return;

  await createNotification({
    ...notifications,
    senderId: actorId,
    targetType: "deals",
    targetId: null,
    title: "Deal update",
    meta: { dealId: deal._id, status },
  });
};

// Builds the small snapshot of deal info that gets embedded in the chat message
const buildSharedDealPayload = (deal) => ({
  dealId: deal._id,
  title: deal.title,
  brand: deal.brand,
  description: deal.description,
  amount: deal.amount,
  currency: deal.currency,
  paymentType: deal.paymentType,
  deliverables: deal.deliverables,
  deadline: deal.deadline,
  status: deal.status,
  paymentStatus: deal.paymentStatus,
  hasReview: Boolean(deal.review?.rating),
});

/*
  After any status change (accept/reject/cancel/pause/resume/start/complete):
  1. Find the chat message that carries this deal (sharedDeal.dealId)
  2. Keep its snapshot status in sync with the real Deal status
  3. Notify BOTH sides over sockets so whoever has the chat open right now
     sees the update live, without needing to refetch or reload
*/
const syncDealStatusAndNotify = async (io, deal) => {
  try {
    await notifyDealStatus(deal);

    const updatedMessage = await MessageModel.findOneAndUpdate(
      { "sharedDeal.dealId": deal._id },
      {
        $set: {
          "sharedDeal.status": deal.status,
          "sharedDeal.paymentStatus": deal.paymentStatus,
          "sharedDeal.hasReview": Boolean(deal.review?.rating),
        },
      },
      { new: true },
    );

    if (!updatedMessage || !io) return;

    const payload = {
      dealId: deal._id.toString(),
      status: deal.status,
      paymentStatus: deal.paymentStatus,
      hasReview: Boolean(deal.review?.rating),
      messageId: updatedMessage._id,
      conversationId: updatedMessage.conversationId,
    };

    io.to(updatedMessage.conversationId).emit("deal_status_updated", payload);
    io.to(`user_${deal.sender}`).emit("deal_status_updated", payload);
    io.to(`user_${deal.receiver}`).emit("deal_status_updated", payload);
  } catch (err) {
    console.error("syncDealStatusAndNotify error:", err);
  }
};

// ---------- 1. CREATE DEAL (sender -> receiver) ----------
const createDeal = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, createDealSchema);
  if (error) return res.status(400).json({ status: "fail", message: error });

  try {
    const io = req.app.get("socketio");
    const senderId = req.user._id;
    const { receiver } = validatedData;

    if (receiver === senderId) {
      return res.status(400).json({
        status: "fail",
        message: "You cannot send a deal to yourself",
      });
    }

    const deal = await Deal.create({
      ...validatedData,
      sender: senderId,
      statusHistory: [
        {
          status: DEAL_STATUS.PENDING,
          changedBy: senderId,
          note: "Deal created",
        },
      ],
    });

    const sharedDeal = buildSharedDealPayload(deal);

    // ---- Send the deal into the receiver's inbox (same pattern as sharePost) ----
    let conversation = await ConversationModel.findOne({
      participants: { $all: [senderId, receiver] },
    }).sort({ lastUpdated: -1 });

    let newMessage;

    if (conversation) {
      newMessage = await MessageModel.create({
        conversationId: conversation.conversationId,
        senderId,
        receiverId: receiver,
        message: DEAL_MESSAGE,
        sharedDeal,
      });

      conversation.lastMessage = {
        message: DEAL_MESSAGE,
        sender: senderId,
        createdAt: new Date(),
      };
      conversation.lastUpdated = new Date();
      conversation.messagesCount += 1;

      const currentUnreadCount =
        conversation.unreadMessagesCount.get(receiver.toString()) ||
        conversation.unreadMessagesCount.get(receiver) ||
        0;
      conversation.unreadMessagesCount.set(receiver, currentUnreadCount + 1);

      await conversation.save();

      const conObj = {
        conversationId: conversation.conversationId,
        lastMessage: conversation.lastMessage,
        lastUpdated: conversation.lastUpdated,
        unreadMessagesCount: Object.fromEntries(
          conversation.unreadMessagesCount,
        ),
      };

      if (io) {
        io.to(`user_${receiver}`).emit("update_conversation", conObj);
        io.to(`user_${senderId}`).emit("update_conversation", conObj);
        io.to(conversation.conversationId).emit("receive_message", newMessage);
      }
    } else {
      const payload = {
        participants: [senderId, receiver],
        conversationId: `${senderId}_${receiver}`,
        lastMessage: {
          message: DEAL_MESSAGE,
          sender: senderId,
          createdAt: new Date(),
        },
        lastUpdated: new Date(),
        messagesCount: 1,
        unreadMessagesCount: new Map([
          [receiver, 1],
          [senderId, 0],
        ]),
      };

      conversation = await ConversationModel.create(payload);

      newMessage = await MessageModel.create({
        conversationId: conversation.conversationId,
        senderId,
        receiverId: receiver,
        message: DEAL_MESSAGE,
        sharedDeal,
      });

      const populatedConversation = await conversation.populate([
        { path: "participants", select: "_id image firstName lastName" },
      ]);

      if (io) {
        io.to(`user_${receiver}`).emit(
          "new_conversation",
          populatedConversation,
        );
        io.to(`user_${senderId}`).emit(
          "new_conversation",
          populatedConversation,
        );
        io.to(conversation.conversationId).emit("receive_message", newMessage);
      }
    }

    await notifyDealStatus(deal);

    return res.status(200).json({
      status: "success",
      message: "Deal sent successfully",
      data: deal,
    });
  } catch (err) {
    console.error("createDeal error:", err);
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

// ---------- 2. GET single deal ----------
const getDealById = async (req, res) => {
  try {
    const { dealId } = req.params;

    const deal = await Deal.findById(dealId)
      .populate("sender", "image firstName lastName username email")
      .populate("receiver", "image firstName lastName username email");

    if (!deal) {
      return res
        .status(404)
        .json({ status: "fail", message: "Deal not found" });
    }

    return res.status(200).json({
      status: "success",
      data: deal,
      message: "Deal fetched successfully",
    });
  } catch (err) {
    console.error("getDealById error:", err);
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

// ---------- 3. GET deals sent by me (as sender) ----------
const getSentDeals = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { status = DEAL_STATUS.PENDING } = req.query;
    const { page, limit, skip } = parsePagination(req);

    const filter = { sender: new mongoose.Types.ObjectId(senderId) };
    if (status) filter.status = status;

    const results = await Deal.aggregate([
      { $match: { ...filter } },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "receiver",
          foreignField: "_id",
          as: "receiver",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$receiver", preserveNullAndEmptyArrays: true } },
      { $sort: { updatedAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    const pagination = {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    return res.status(200).json({
      status: "success",
      data,
      pagination,
      message: "Deal fetched successfully",
    });
  } catch (err) {
    console.error("getSentDeals error:", err);
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

// ---------- 4. GET deals received by me (as receiver) ----------
const getReceivedDeals = async (req, res) => {
  try {
    const receiverId = req.user.id;
    const { status = DEAL_STATUS.PENDING } = req.query;
    const { page, limit, skip } = parsePagination(req);

    const filter = { receiver: new mongoose.Types.ObjectId(receiverId) };
    if (status) filter.status = status;

    const results = await Deal.aggregate([
      { $match: { ...filter } },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "receiver",
          foreignField: "_id",
          as: "receiver",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$receiver", preserveNullAndEmptyArrays: true } },
      { $sort: { updatedAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    const pagination = {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    return res.status(200).json({
      status: "success",
      data,
      pagination,
      message: "Deal fetched successfully",
    });
  } catch (err) {
    console.error("getReceivedDeals error:", err);
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

// ---------- 5. GET active deals (accepted deals - either side) ----------
const getCompletedDeals = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, skip } = parsePagination(req);

    const results = await Deal.aggregate([
      {
        $match: {
          status: DEAL_STATUS.COMPLETED,
          $or: [
            { sender: new mongoose.Types.ObjectId(userId) },
            { receiver: new mongoose.Types.ObjectId(userId) },
          ],
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "receiver",
          foreignField: "_id",
          as: "receiver",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$receiver", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "reviews",
          localField: "review",
          foreignField: "_id",
          as: "review",
          pipeline: [{ $project: { rating: 1, comment: 1 } }],
        },
      },
      { $unwind: { path: "$receiver", preserveNullAndEmptyArrays: true } },
      { $sort: { respondedAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    const pagination = {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    return res.status(200).json({
      status: "success",
      data,
      pagination,
      message: "Active deals fetched successfully",
    });
  } catch (err) {
    console.error("getCompletedDeals error:", err);
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

// ---------- 6. GET deals in progress (accepted + started + completed, either side) ----------
const getDealsInProgress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, skip } = parsePagination(req);

    const results = await Deal.aggregate([
      {
        $match: {
          status: {
            $in: [
              DEAL_STATUS.ACCEPTED,
              DEAL_STATUS.STARTED,
              DEAL_STATUS.VERIFYING,
              DEAL_STATUS.INCOMPLETE,
            ],
          },
          $or: [
            { sender: new mongoose.Types.ObjectId(userId) },
            { receiver: new mongoose.Types.ObjectId(userId) },
          ],
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "receiver",
          foreignField: "_id",
          as: "receiver",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$receiver", preserveNullAndEmptyArrays: true } },
      { $sort: { updatedAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    const pagination = {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    return res.status(200).json({
      status: "success",
      data,
      pagination,
      message: "Deals in progress fetched successfully",
    });
  } catch (err) {
    console.error("getDealsInProgress error:", err);
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

// ---------- 7. GET cancelled or paused deals ----------
const getCancelledOrPausedDeals = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, skip } = parsePagination(req);

    const results = await Deal.aggregate([
      {
        $match: {
          status: { $in: [DEAL_STATUS.CANCELLED, DEAL_STATUS.PAUSED] },
          $or: [
            { sender: new mongoose.Types.ObjectId(userId) },
            { receiver: new mongoose.Types.ObjectId(userId) },
          ],
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "receiver",
          foreignField: "_id",
          as: "receiver",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$receiver", preserveNullAndEmptyArrays: true } },
      { $sort: { updatedAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    const pagination = {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    return res.status(200).json({
      status: "success",
      data,
      pagination,
      message: "Cancelled/paused deals fetched successfully",
    });
  } catch (err) {
    console.error("getCancelledOrPausedDeals error:", err);
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

// ---------- 8. ACCEPT deal (receiver only) ----------
const acceptDeal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { dealId } = req.params;
    const io = req.app.get("socketio");

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res
        .status(404)
        .json({ status: "fail", message: "Deal not found" });
    }

    if (deal.receiver.toString() !== userId) {
      return res.status(403).json({
        status: "fail",
        message: "Only the receiver can accept this deal",
      });
    }

    await deal.acceptDeal(userId);
    await syncDealStatusAndNotify(io, deal);

    return res.status(200).json({
      status: "success",
      message: "Deal accepted successfully",
      data: deal,
    });
  } catch (err) {
    console.error("acceptDeal error:", err);
    return res.status(400).json({ status: "fail", message: err.message });
  }
};

// ---------- 9. REJECT deal (receiver only) ----------
const rejectDeal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { dealId } = req.params;
    const { reason = "" } = req.body;
    const io = req.app.get("socketio");

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res
        .status(404)
        .json({ status: "fail", message: "Deal not found" });
    }

    if (deal.receiver.toString() !== userId) {
      return res.status(403).json({
        status: "fail",
        message: "Only the receiver can reject this deal",
      });
    }

    await deal.rejectDeal(userId, reason);
    await syncDealStatusAndNotify(io, deal);

    return res
      .status(200)
      .json({ status: "success", message: "Deal rejected", data: deal });
  } catch (err) {
    console.error("rejectDeal error:", err);
    return res.status(400).json({ status: false, message: err.message });
  }
};

// ---------- 10. CANCEL deal (sender only) ----------
const cancelDeal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { dealId } = req.params;
    const { reason = "" } = req.body;
    const io = req.app.get("socketio");

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res
        .status(404)
        .json({ status: "fail", message: "Deal not found" });
    }

    if (deal.sender.toString() !== userId) {
      return res.status(403).json({
        status: "fail",
        message: "Only the sender can cancel this deal",
      });
    }

    await deal.cancelDeal(userId, reason);
    await syncDealStatusAndNotify(io, deal);

    return res
      .status(200)
      .json({ status: "success", message: "Deal cancelled", data: deal });
  } catch (err) {
    console.error("cancelDeal error:", err);
    return res.status(400).json({ status: "fail", message: err.message });
  }
};

// ---------- 11. PAUSE deal (sender only) ----------
const pauseDeal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { dealId } = req.params;
    const io = req.app.get("socketio");

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res
        .status(404)
        .json({ status: "fail", message: "Deal not found" });
    }

    if (deal.sender.toString() !== userId) {
      return res.status(403).json({
        status: "fail",
        message: "Only the sender can pause this deal",
      });
    }

    await deal.pauseDeal(userId);
    await syncDealStatusAndNotify(io, deal);

    return res
      .status(200)
      .json({ status: "success", message: "Deal paused", data: deal });
  } catch (err) {
    console.error("pauseDeal error:", err);
    return res.status(400).json({ status: "fail", message: err.message });
  }
};

// ---------- 12. RESUME deal (sender only, paused -> pending) ----------
const resumeDeal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { dealId } = req.params;
    const io = req.app.get("socketio");

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res
        .status(404)
        .json({ status: "fail", message: "Deal not found" });
    }

    if (deal.sender.toString() !== userId) {
      return res.status(403).json({
        status: "fail",
        message: "Only the sender can resume this deal",
      });
    }

    await deal.resumeDeal(userId);
    await syncDealStatusAndNotify(io, deal);

    return res.status(200).json({
      status: "success",
      message: "Deal resumed, receiver can respond again",
      data: deal,
    });
  } catch (err) {
    console.error("resumeDeal error:", err);
    return res.status(400).json({ status: "fail", message: err.message });
  }
};

// ---------- 13. PAY for deal (sender only, accepted -> started) ----------
const payForDeal = async (req, res) => {
  const idempotencyKey = req.headers["idempotency-key"];
  if (!idempotencyKey) {
    return res
      .status(400)
      .json({ message: "Idempotency-Key header is required", status: "fail" });
  }

  const [error, validatedData] = schemaValidator(req.body, dealPaymentSchema);
  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  const { dealId } = req.params;
  const { paymentMethodId, isSave } = validatedData;
  const user = req.user;
  const io = req.app.get("socketio");

  const deal = await Deal.findById(dealId);
  if (!deal) {
    return res.status(404).json({ status: "fail", message: "Deal not found" });
  }

  if (deal.sender.toString() !== user._id.toString()) {
    return res.status(403).json({
      status: "fail",
      message: "Only the sender can pay for this deal",
    });
  }

  if (deal.status !== DEAL_STATUS.ACCEPTED) {
    return res.status(400).json({
      status: "fail",
      message: "Deal is not accepted by receiver yet",
    });
  }

  // ---- Payment attempt (charged to the platform's own Stripe balance) ----
  try {
    const amountInCents = dollarsToCents(deal.amount);

    const completeData = await UserModel.findById(user._id)
      .select("stripeCustomerId")
      .lean();
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency: "usd",
        payment_method: paymentMethodId,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        customer: completeData.stripeCustomerId,
        setup_future_usage: req.body.isSave ? "off_session" : undefined,
        metadata: {
          dealId: deal._id.toString(),
          type: "payment for deal",
        },
      },
      { idempotencyKey },
    );

    if (paymentIntent.status === "requires_action") {
      deal.paymentIntentId = paymentIntent.id;
      await deal.save();
      return res.status(200).json({
        status: "requires_action",
        message: "Additional authentication required",
        clientSecret: paymentIntent.client_secret,
        dealId: deal._id,
      });
    }

    if (paymentIntent.status === "succeeded") {
      // status: accepted -> started, paymentStatus: paid
      await deal.startDeal(user._id, paymentIntent.id);
      await syncDealStatusAndNotify(io, deal);

      return res.status(201).json({
        status: "success",
        message: "Payment successful, deal started",
        data: deal,
      });
    }

    deal.paymentStatus = "failed";
    await deal.save();
    return res.status(402).json({
      status: "fail",
      message: "Payment failed",
      dealId: deal._id,
    });
  } catch (err) {
    deal.paymentStatus = "failed";
    await deal.save().catch(() => { });

    if (err.type === "StripeCardError") {
      return res.status(402).json({
        status: "fail",
        message: err.message,
        dealId: deal._id,
      });
    }
    return res.status(500).json({
      status: "fail",
      message: "Payment processing error. Please retry.",
      dealId: deal._id,
    });
  }
};

// ---------- 14. COMPLETE deal (receiver only, started -> completed) ----------
// const completeDeal = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { dealId } = req.params;
//     const io = req.app.get("socketio");

//     const deal = await Deal.findById(dealId);
//     if (!deal) {
//       return res
//         .status(404)
//         .json({ status: "fail", message: "Deal not found" });
//     }

//     if (deal.receiver.toString() !== userId) {
//       return res.status(403).json({
//         status: "fail",
//         message: "Only the receiver can mark this deal as complete",
//       });
//     }

//     await deal.completeDeal(userId);
//     await syncDealStatusAndNotify(io, deal);

//     return res.status(200).json({
//       status: "success",
//       message: "Deal marked as complete",
//       data: deal,
//     });
//   } catch (err) {
//     console.error("completeDeal error:", err);
//     return res.status(400).json({ status: "fail", message: err.message });
//   }
// };

// ---------- 14. REQUEST COMPLETION (receiver only, started/incomplete -> verifying) ----------

const requestDealCompletion = async (req, res) => {
  try {
    const userId = req.user.id;
    const { dealId } = req.params;
    const io = req.app.get("socketio");

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res
        .status(404)
        .json({ status: "fail", message: "Deal not found" });
    }

    if (deal.receiver.toString() !== userId) {
      return res.status(403).json({
        status: "fail",
        message: "Only the receiver can request completion for this deal",
      });
    }

    await deal.requestCompletion(userId);
    await syncDealStatusAndNotify(io, deal);

    return res.status(200).json({
      status: "success",
      message: "Completion requested, awaiting sender's verification",
      data: deal,
    });
  } catch (err) {
    console.error("requestCompletion error:", err);
    return res.status(400).json({ status: "fail", message: err.message });
  }
};

// ---------- 15. VERIFY COMPLETION (sender only, verifying -> completed/incomplete) ----------
const verifyDealCompletion = async (req, res) => {
  try {
    const userId = req.user.id;
    const { dealId } = req.params;
    const { approved, note = "" } = req.body;
    const io = req.app.get("socketio");

    if (typeof approved !== "boolean") {
      return res.status(400).json({
        status: "fail",
        message: "'approved' (true/false) is required",
      });
    }

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res
        .status(404)
        .json({ status: "fail", message: "Deal not found" });
    }

    if (deal.sender.toString() !== userId) {
      return res.status(403).json({
        status: "fail",
        message: "Only the sender can verify this deal's completion",
      });
    }

    await deal.verifyCompletion(userId, approved, note);
    await syncDealStatusAndNotify(io, deal);

    return res.status(200).json({
      status: "success",
      message: approved
        ? "Deal verified and marked as complete"
        : "Deal marked as incomplete, receiver can address it and resubmit",
      data: deal,
    });
  } catch (err) {
    console.error("verifyCompletion error:", err);
    return res.status(400).json({ status: "fail", message: err.message });
  }
};

// ---------- 15b. ADMIN VERIFY INCOMPLETE DEAL (incomplete -> completed) ----------
const adminVerifyIncompleteDeal = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    adminVerifyIncompleteDealSchema,
  );
  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  try {
    const adminId = req.admin._id;
    const { dealId } = req.params;
    const { note = "" } = validatedData;
    const io = req.app.get("socketio");

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res
        .status(404)
        .json({ status: "fail", message: "Deal not found" });
    }

    if (deal.status !== DEAL_STATUS.INCOMPLETE) {
      return res.status(400).json({
        status: "fail",
        message: "Only deals marked incomplete by the sender can be verified by admin",
      });
    }

    await deal.adminMarkIncompleteAsComplete(adminId, note);
    await syncDealStatusAndNotify(io, deal);

    return res.status(200).json({
      status: "success",
      message: "Deal verified and marked as complete by admin",
      data: deal,
    });
  } catch (err) {
    console.error("adminVerifyIncompleteDeal error:", err);
    return res.status(400).json({ status: "fail", message: err.message });
  }
};

// ---------- 16. ADD REVIEW (sender only, once deal is completed) ----------
const addReview = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, dealReviewSchema);
  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const userId = req.user.id;
    const { dealId } = req.params;
    const { rating, comment } = validatedData;
    const io = req.app.get("socketio");

    if (!rating || rating < 1 || rating > 5) {
      throw new Error("Rating must be between 1 and 5");
    }

    const deal = await Deal.findById(dealId).session(session);

    if (!deal) {
      throw new Error("Deal not found");
    }

    if (deal.sender.toString() !== userId) {
      throw new Error("Only the sender can review this deal");
    }

    if (deal.status !== DEAL_STATUS.COMPLETED) {
      throw new Error(
        "Review can only be submitted once the deal is completed",
      );
    }

    if (deal.isReviewed) {
      throw new Error("Review already submitted");
    }

    const receiver = await UserModel.findById(deal.receiver).session(session);

    if (!receiver) {
      throw new Error("Receiver not found");
    }

    const [review] = await ReviewModel.create(
      [
        {
          reviewer: userId,
          reviewee: deal.receiver,
          targetType: "deal",
          targetId: deal._id,
          rating,
          comment,
        },
      ],
      { session },
    );

    await deal.addReview(review._id, session);

    await receiver.addRating(rating, session);

    await session.commitTransaction();
    session.endSession();

    await syncDealStatusAndNotify(io, deal);

    return res.status(200).json({
      status: "success",
      message: "Review submitted successfully",
      data: {
        deal,
        review,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error("addReview error:", err);

    return res.status(400).json({
      status: "fail",
      message: err.message,
    });
  }
};

// ---------- 17. GET RECEIVED DEALS IN START STATUS (receiver only, started/verifying/incomplete) ----------
const getReceivedDealsInStartStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.query; // "post" | "reel" | "stream" | "story"
    const { page, limit, skip } = parsePagination(req);

    if (!type || !["post", "reel", "stream", "story"].includes(type)) {
      return res.status(400).json({
        status: "fail",
        message: "A valid type (post, reel, stream, or story) is required",
      });
    }

    const results = await Deal.aggregate([
      {
        $match: {
          status: DEAL_STATUS.STARTED,
          receiver: new mongoose.Types.ObjectId(userId),
        },
      },

      // Get all deliverables of requested type and add isCompleted flag
      {
        $addFields: {
          matchingDeliverables: {
            $map: {
              input: {
                $filter: {
                  input: "$deliverables",
                  as: "d",
                  cond: {
                    $eq: ["$$d.type", type],
                  },
                },
              },
              as: "d",
              in: {
                $mergeObjects: [
                  "$$d",
                  {
                    isCompleted: {
                      $gte: ["$$d.completed", "$$d.count"],
                    },
                  },
                ],
              },
            },
          },
        },
      },

      // Only keep deals having at least one deliverable of this type
      {
        $match: {
          "matchingDeliverables.0": { $exists: true },
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
          pipeline: [
            {
              $project: {
                image: 1,
                firstName: 1,
                lastName: 1,
                username: 1,
              },
            },
          ],
        },
      },
      {
        $unwind: {
          path: "$sender",
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "receiver",
          foreignField: "_id",
          as: "receiver",
          pipeline: [
            {
              $project: {
                image: 1,
                firstName: 1,
                lastName: 1,
                username: 1,
              },
            },
          ],
        },
      },
      {
        $unwind: {
          path: "$receiver",
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $sort: {
          updatedAt: -1,
        },
      },

      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    const pagination = {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    return res.status(200).json({
      status: "success",
      data,
      pagination,
      message: "Active deals awaiting this content type fetched successfully",
    });
  } catch (err) {
    console.error("getReceivedDealsInStartStatus error:", err);
    return res.status(500).json({
      status: "fail",
      message: err.message,
    });
  }
};

// ---------- 18. GET all deals For Admin Dashboard ----------
const getAllDealsForAdminDashboard = async (req, res) => {
  try {
    const { status = "" } = req.query;
    const { page, limit, skip } = parsePagination(req);

    const filter = {};
    if (status) filter.status = status;

    const results = await Deal.aggregate([
      { $match: { ...filter } },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "receiver",
          foreignField: "_id",
          as: "receiver",
          pipeline: [
            { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
          ],
        },
      },
      { $unwind: { path: "$receiver", preserveNullAndEmptyArrays: true } },
      { $sort: { updatedAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    const pagination = {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    return res.status(200).json({
      status: "success",
      data,
      pagination,
      message: "Deal fetched successfully",
    });
  } catch (err) {
    console.error("getSentDeals error:", err);
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

module.exports = {
  createDeal,
  getDealById,
  getSentDeals,
  getReceivedDeals,
  getCompletedDeals,
  getDealsInProgress,
  getCancelledOrPausedDeals,
  acceptDeal,
  rejectDeal,
  cancelDeal,
  pauseDeal,
  resumeDeal,
  payForDeal,
  // completeDeal,
  requestDealCompletion,
  verifyDealCompletion,
  adminVerifyIncompleteDeal,
  addReview,
  getReceivedDealsInStartStatus,
  getAllDealsForAdminDashboard
};

// const getReceivedDealsInStartStatus = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { type } = req.query; // "post" | "reel" | "stream"
//     const { page, limit, skip } = parsePagination(req);

//     if (!type || !["post", "reel", "stream","story"].includes(type)) {
//       return res.status(400).json({
//         status: "fail",
//         message: "A valid type (post, reel, stream, or story) is required",
//       });
//     }

//     const results = await Deal.aggregate([
//       {
//         $match: {
//           status: DEAL_STATUS.STARTED,
//           receiver: new mongoose.Types.ObjectId(userId),
//         },
//       },
//       // Keep only deliverables of the requested type that still have
//       // remaining count (completed < count)
//       {
//         $addFields: {
//           matchingDeliverables: {
//             $filter: {
//               input: "$deliverables",
//               as: "d",
//               cond: {
//                 $and: [
//                   { $eq: ["$$d.type", type] },
//                   { $lt: ["$$d.completed", "$$d.count"] },
//                 ],
//               },
//             },
//           },
//         },
//       },
//       // Only deals that actually have at least one remaining deliverable
//       // of this type show up in the selection list
//       { $match: { "matchingDeliverables.0": { $exists: true } } },
//       {
//         $lookup: {
//           from: "users",
//           localField: "sender",
//           foreignField: "_id",
//           as: "sender",
//           pipeline: [
//             { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
//           ],
//         },
//       },
//       { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
//       {
//         $lookup: {
//           from: "users",
//           localField: "receiver",
//           foreignField: "_id",
//           as: "receiver",
//           pipeline: [
//             { $project: { image: 1, firstName: 1, lastName: 1, username: 1 } },
//           ],
//         },
//       },
//       { $unwind: { path: "$receiver", preserveNullAndEmptyArrays: true } },
//       // deadline is already part of the deal document, no projection needed
//       // so it stays included automatically for the selection UI
//       { $sort: { deadline: 1 } },
//       {
//         $facet: {
//           metadata: [{ $count: "total" }],
//           data: [{ $skip: skip }, { $limit: limit }],
//         },
//       },
//     ]);

//     const data = results[0]?.data ?? [];
//     const totalCount = results[0]?.metadata[0]?.total ?? 0;
//     const totalPages = Math.ceil(totalCount / limit);

//     const pagination = {
//       page,
//       limit,
//       totalCount,
//       totalPages,
//       hasNextPage: page < totalPages,
//       hasPrevPage: page > 1,
//     };

//     return res.status(200).json({
//       status: "success",
//       data,
//       pagination,
//       message: "Active deals awaiting this content type fetched successfully",
//     });
//   } catch (err) {
//     console.error("getReceivedDealsInStartStatus error:", err);
//     return res.status(500).json({ status: "fail", message: err.message });
//   }
// };
