const mongoose = require("mongoose");
const LikeModel = require("../models/like");
const CommentModel = require("../models/comment");
const ShareModel = require("../models/share");
const PostModel = require("../models/post");
const CampaignModel = require("../models/campaign");
const MessageModel = require("../models/message");
const ConversationModel = require("../models/conversation");
const { logActivity } = require("./activityLogger");
const { createNotification } = require("./notificationHelper");
const { buildAggregatePagination } = require("./helper");
const {
  AUTHOR_FIELDS,
  parsePagination,
  buildPagination,
  sanitizeAuthor,
} = require("./socialHelpers");

const SHARE_MESSAGE = "Sent an attachment";

let _PostAnalytics;
let _BoostAnalytics;
let _Boost;
const getPostAnalyticsModel = () => (_PostAnalytics ||= require("../models/postAnalytics"));
const getBoostAnalyticsModel = () => (_BoostAnalytics ||= require("../models/boostAnalytics"));
const getBoostModel = () => (_Boost ||= require("../models/boost"));

// Fire-and-forget — increment PostAnalytics + BoostAnalytics for engagement
const trackEngagement = async (postId, field) => {
  try {
    if (!postId) return;
    const PostAnalytics = getPostAnalyticsModel();

    const dateOnly = new Date();
    dateOnly.setHours(0, 0, 0, 0);

    await PostAnalytics.findOneAndUpdate(
      { postId, dateOnly },
      { $inc: { [field]: 1 }, $setOnInsert: { postId, dateOnly } },
      { upsert: true },
    );

    const Post = require("../models/post");
    const post = await Post.findById(postId).select("isBoosted boostId").lean();
    if (post?.isBoosted && post?.boostId) {
      const now = new Date();
      const Boost = getBoostModel();
      const BoostAnalytics = getBoostAnalyticsModel();
      const activeBoost = await Boost.findOne({
        _id: post.boostId,
        status: "active",
        startDate: { $lte: now },
        endDate: { $gt: now },
      }).lean();
      if (activeBoost) {
        const boostField = `total${field.charAt(0).toUpperCase() + field.slice(1)}`;
        await BoostAnalytics.findOneAndUpdate(
          { boostId: activeBoost._id },
          {
            $inc: { [boostField]: 1 },
            $setOnInsert: {
              postId: activeBoost.postId,
              creatorId: activeBoost.creatorId,
              objective: activeBoost.objective,
            },
          },
          { upsert: true },
        );
      }
    }
  } catch (err) {
    console.error("trackEngagement error:", err);
  }
};

const resolveTarget = async (targetType, targetId) => {
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    const err = new Error("Invalid target id");
    err.statusCode = 400;
    throw err;
  }

  if (targetType === "post") {
    const doc = await PostModel.findById(targetId);
    if (!doc) {
      const err = new Error("Post not found");
      err.statusCode = 404;
      throw err;
    }
    return {
      targetType: "post",
      targetId: doc._id,
      doc,
      Model: PostModel,
      ownerId: doc.authorId,
      label: "post",
    };
  }

  if (targetType === "campaign") {
    const doc = await CampaignModel.findById(targetId);
    if (!doc) {
      const err = new Error("Campaign not found");
      err.statusCode = 404;
      throw err;
    }
    return {
      targetType: "campaign",
      targetId: doc._id,
      doc,
      Model: CampaignModel,
      ownerId: doc.creator,
      label: "campaign",
    };
  }

  const err = new Error("Invalid target type");
  err.statusCode = 400;
  throw err;
};

const buildLikeFilter = (targetType, targetId) => {
  const oid = new mongoose.Types.ObjectId(targetId);
  if (targetType === "post") {
    return {
      $or: [
        { targetType: "post", targetId: oid },
        { postId: oid, targetType: { $in: [null, "post"] } },
        { postId: oid, targetType: { $exists: false } },
      ],
    };
  }
  return { targetType: "campaign", targetId: oid };
};

const buildCommentFilter = (targetType, targetId) => {
  const oid = new mongoose.Types.ObjectId(targetId);
  if (targetType === "post") {
    return {
      $or: [
        { targetType: "post", targetId: oid },
        { postId: oid, targetType: { $in: [null, "post"] } },
        { postId: oid, targetType: { $exists: false } },
      ],
    };
  }
  return { targetType: "campaign", targetId: oid };
};

const formatComment = (comment) => {
  const doc = comment.toObject ? comment.toObject() : { ...comment };
  return {
    _id: doc._id,
    targetType: doc.targetType || "post",
    targetId: doc.targetId || doc.postId,
    postId: doc.postId || (doc.targetType === "post" ? doc.targetId : undefined),
    authorId: doc.authorId?._id ? doc.authorId._id : doc.authorId,
    author: doc.authorId?._id ? sanitizeAuthor(doc.authorId) : null,
    content: doc.content,
    mentions: doc.mentions || [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const buildSharedPostPayload = (post, postId) => ({
  postId,
  caption: post.caption || "",
  ...(post.media?.[0] && {
    media: {
      url: post.media[0].url,
      mediaType: post.media[0].mediaType,
    },
  }),
});

const buildSharedCampaignPayload = (campaign) => ({
  campaignId: campaign._id,
  brand: campaign.brand,
  name: campaign.name,
  description: campaign.description,
  advertisement: campaign.advertisement,
  endDateTime: campaign.endDateTime,
});

const populateSharedPostMessage = (message) =>
  message.populate({
    path: "sharedPost.postId",
    select: "_id caption media authorId",
    populate: {
      path: "authorId",
      select: "_id image firstName lastName username",
    },
  });

const populateSharedCampaignMessage = (message) =>
  message.populate({
    path: "sharedCampaign.campaignId",
    select:
      "_id brand name description advertisement endDateTime startDateTime likesCount commentsCount sharesCount",
  });

const deliverShareMessages = async ({
  user,
  recipientIds,
  io,
  sharedPost,
  sharedCampaign,
}) => {
  for (const recipientId of recipientIds) {
    const conversation = await ConversationModel.findOne({
      participants: { $all: [user._id, recipientId] },
    }).sort({ lastUpdated: -1 });

    const messagePayload = {
      senderId: user._id,
      receiverId: recipientId,
      message: SHARE_MESSAGE,
      ...(sharedPost ? { sharedPost } : {}),
      ...(sharedCampaign ? { sharedCampaign } : {}),
    };

    if (conversation) {
      const newMessage = await MessageModel.create({
        conversationId: conversation.conversationId,
        ...messagePayload,
      });

      conversation.lastMessage = {
        message: SHARE_MESSAGE,
        sender: user._id,
        createdAt: new Date(),
      };
      conversation.lastUpdated = new Date();
      conversation.messagesCount += 1;

      const currentUnreadCount =
        conversation.unreadMessagesCount.get(recipientId.toString()) ||
        conversation.unreadMessagesCount.get(recipientId) ||
        0;
      conversation.unreadMessagesCount.set(
        recipientId,
        currentUnreadCount + 1,
      );

      await conversation.save();

      const conObj = {
        conversationId: conversation.conversationId,
        lastMessage: conversation.lastMessage,
        lastUpdated: conversation.lastUpdated,
        unreadMessagesCount: Object.fromEntries(
          conversation.unreadMessagesCount,
        ),
      };

      if (sharedPost) await populateSharedPostMessage(newMessage);
      if (sharedCampaign) await populateSharedCampaignMessage(newMessage);

      if (io) {
        io.to(`user_${recipientId}`).emit("update_conversation", conObj);
        io.to(`user_${user._id}`).emit("update_conversation", conObj);
        io.to(conversation.conversationId).emit("receive_message", newMessage);
      }
      continue;
    }

    const payload = {
      participants: [user._id, recipientId],
      conversationId: `${user._id}_${recipientId}`,
      lastMessage: {
        message: SHARE_MESSAGE,
        sender: user._id,
        createdAt: new Date(),
      },
      lastUpdated: new Date(),
      messagesCount: 1,
      unreadMessagesCount: new Map([
        [recipientId, 1],
        [user._id, 0],
      ]),
    };

    const newConversation = await ConversationModel.create(payload);
    const newMessage = await MessageModel.create({
      conversationId: newConversation.conversationId,
      ...messagePayload,
    });

    if (sharedPost) await populateSharedPostMessage(newMessage);
    if (sharedCampaign) await populateSharedCampaignMessage(newMessage);

    const populatedConversation = await newConversation.populate([
      {
        path: "participants",
        select: "_id image firstName lastName",
      },
    ]);

    if (io) {
      io.to(`user_${recipientId}`).emit(
        "new_conversation",
        populatedConversation,
      );
      io.to(`user_${user._id}`).emit("new_conversation", populatedConversation);
      io.to(newConversation.conversationId).emit("receive_message", newMessage);
    }
  }
};

const likeTarget = async ({ targetType, targetId, user, req }) => {
  const target = await resolveTarget(targetType, targetId);

  const existing = await LikeModel.findOne({
    userId: user._id,
    ...buildLikeFilter(target.targetType, target.targetId),
  });
  if (existing) {
    const err = new Error("Already liked");
    err.statusCode = 400;
    err.code = 11000;
    throw err;
  }

  const likePayload = {
    userId: user._id,
    targetType: target.targetType,
    targetId: target.targetId,
  };
  if (target.targetType === "post") {
    likePayload.postId = target.targetId;
  }

  await LikeModel.create(likePayload);

  setImmediate(async () => {
    const isCampaign = target.targetType === "campaign";
    const tasks = [
      target.Model.findByIdAndUpdate(target.targetId, {
        $inc: { likesCount: 1 },
      }),
      trackEngagement(target.targetId, "likes"),
      logActivity(req, {
        userId: user._id,
        action: isCampaign ? "campaign_liked" : "post_liked",
        targetType: isCampaign ? "campaigns" : "posts",
        targetId: target.targetId,
        meta: {
          [isCampaign ? "campaignId" : "postId"]: target.targetId,
          message: `You have liked a ${target.label}`,
        },
      }),
    ];

    if (target.ownerId?.toString() !== user._id.toString()) {
      tasks.push(
        createNotification({
          recipientId: target.ownerId,
          senderId: user._id,
          type: isCampaign ? "campaign_liked" : "post_liked",
          targetType: isCampaign ? "campaigns" : "posts",
          targetId: target.targetId,
          title: isCampaign ? "Campaign liked" : "Post liked",
          message: `Your ${target.label} has been liked by ${user.firstName} ${user.lastName}`,
          meta: {
            [isCampaign ? "campaignId" : "postId"]: target.targetId,
            userId: user._id,
          },
        }),
      );
    }

    await Promise.allSettled(tasks);
  });

  return {
    message: `${target.label[0].toUpperCase()}${target.label.slice(1)} liked`,
  };
};

const unlikeTarget = async ({ targetType, targetId, user, req }) => {
  const target = await resolveTarget(targetType, targetId);
  const result = await LikeModel.deleteOne({
    userId: user._id,
    ...buildLikeFilter(target.targetType, target.targetId),
  });

  if (result.deletedCount === 0) {
    const err = new Error("Like not found");
    err.statusCode = 404;
    throw err;
  }

  setImmediate(async () => {
    const isCampaign = target.targetType === "campaign";
    await Promise.allSettled([
      target.Model.findByIdAndUpdate(target.targetId, {
        $inc: { likesCount: -1 },
      }),
      logActivity(req, {
        userId: user._id,
        action: isCampaign ? "campaign_unliked" : "post_unliked",
        targetType: isCampaign ? "campaigns" : "posts",
        targetId: target.targetId,
        meta: {
          [isCampaign ? "campaignId" : "postId"]: target.targetId,
          message: `You have unliked a ${target.label}`,
        },
      }),
    ]);
  });

  return {
    message: `${target.label[0].toUpperCase()}${target.label.slice(1)} unliked`,
  };
};

const listLikes = async ({ targetType, targetId, req }) => {
  await resolveTarget(targetType, targetId);
  const { page, limit, skip } = parsePagination(req);
  const match = buildLikeFilter(targetType, targetId);

  const results = await LikeModel.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              "user._id": 1,
              "user.firstName": 1,
              "user.lastName": 1,
              "user.username": 1,
              "user.image": 1,
              "user.isVerified": 1,
              createdAt: 1,
            },
          },
        ],
      },
    },
  ]);

  return buildAggregatePagination(req, results);
};

const createCommentOnTarget = async ({
  targetType,
  targetId,
  content,
  mentions,
  user,
  req,
}) => {
  if (!content || !String(content).trim()) {
    const err = new Error("content is required");
    err.statusCode = 400;
    throw err;
  }

  const target = await resolveTarget(targetType, targetId);
  const commentPayload = {
    targetType: target.targetType,
    targetId: target.targetId,
    authorId: user._id,
    content: String(content).trim(),
  };
  if (target.targetType === "post") {
    commentPayload.postId = target.targetId;
  }

  // Validate mentioned user IDs
  let validMentionIds = [];
  if (Array.isArray(mentions) && mentions.length > 0) {
    const UserModel = require("../models/auth");
    const sanitizedIds = mentions
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (sanitizedIds.length > 0) {
      const mentionedUsers = await UserModel.find({
        _id: { $in: sanitizedIds },
      }).select("_id");
      const validSet = new Set(
        mentionedUsers.map((u) => u._id.toString()),
      );
      validMentionIds = sanitizedIds.filter((id) => {
        const sid = id.toString();
        // Filter out invalid IDs and self-mentions
        return validSet.has(sid) && sid !== user._id.toString();
      });
    }
  }
  if (validMentionIds.length > 0) {
    commentPayload.mentions = validMentionIds;
  }

  const comment = await CommentModel.create(commentPayload);
  await target.Model.findByIdAndUpdate(target.targetId, {
    $inc: { commentsCount: 1 },
  });
  trackEngagement(target.targetId, "comments");
  await comment.populate("authorId", AUTHOR_FIELDS);

  setImmediate(async () => {
    const isCampaign = target.targetType === "campaign";
    const tasks = [
      logActivity(req, {
        userId: user._id,
        action: "comment_added",
        targetType: "comments",
        targetId: comment._id,
        meta: {
          [isCampaign ? "campaignId" : "postId"]: target.targetId,
          message: "Comment created successfully",
        },
      }),
    ];

    // Notify post/campaign owner
    if (target.ownerId?.toString() !== user._id.toString()) {
      tasks.push(
        createNotification({
          recipientId: target.ownerId,
          senderId: user._id,
          type: isCampaign ? "campaign_commented" : "post_commented",
          targetType: "comments",
          targetId: comment._id,
          title: "New comment",
          message: `Your ${target.label} has a new comment by ${user.firstName} ${user.lastName}`,
          meta: {
            [isCampaign ? "campaignId" : "postId"]: target.targetId,
            commentId: comment._id,
          },
        }),
      );
    }

    // Notify mentioned users
    if (validMentionIds.length > 0) {
      const UserModel = require("../models/auth");
      const mentionedUsers = await UserModel.find({
        _id: { $in: validMentionIds },
      }).select("_id firstName lastName");

      for (const mu of mentionedUsers) {
        // Skip post owner (already notified above) and self
        if (
          mu._id.toString() !== user._id.toString() &&
          mu._id.toString() !== target.ownerId?.toString()
        ) {
          tasks.push(
            createNotification({
              recipientId: mu._id,
              senderId: user._id,
              type: "comment_mentioned",
              targetType: "posts",
              targetId: target.targetId,
              title: "Mentioned in a comment",
              message: `${user.firstName} ${user.lastName} mentioned you in a comment`,
              meta: {
                postId: target.targetId,
                commentId: comment._id,
                authorId: user._id,
              },
            }),
          );
        }
      }
    }

    await Promise.allSettled(tasks);
  });

  return formatComment(comment);
};

const deleteCommentOnTarget = async ({
  targetType,
  targetId,
  commentId,
  user,
  req,
}) => {
  const target = await resolveTarget(targetType, targetId);
  const comment = await CommentModel.findOne({
    _id: commentId,
    ...buildCommentFilter(target.targetType, target.targetId),
  });

  if (!comment) {
    const err = new Error("Comment not found");
    err.statusCode = 404;
    throw err;
  }

  if (comment.authorId.toString() !== user._id.toString()) {
    const err = new Error("You can only perform this action on your own content");
    err.statusCode = 403;
    throw err;
  }

  await CommentModel.deleteOne({ _id: commentId });

  if ((target.doc.commentsCount || 0) > 0) {
    await target.Model.findByIdAndUpdate(target.targetId, {
      $inc: { commentsCount: -1 },
    });
  }

  setImmediate(async () => {
    const isCampaign = target.targetType === "campaign";
    await logActivity(req, {
      userId: user._id,
      action: "comment_deleted",
      targetType: "comments",
      targetId: comment._id,
      meta: {
        [isCampaign ? "campaignId" : "postId"]: target.targetId,
        message: "Comment deleted successfully",
      },
    });
  });

  return { message: "Comment deleted successfully" };
};

const listComments = async ({ targetType, targetId, req }) => {
  await resolveTarget(targetType, targetId);
  const { page, limit, skip } = parsePagination(req);
  const filter = buildCommentFilter(targetType, targetId);

  const [comments, totalComments] = await Promise.all([
    CommentModel.find(filter)
      .populate("authorId", AUTHOR_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    CommentModel.countDocuments(filter),
  ]);

  return {
    comments: comments.map(formatComment),
    pagination: buildPagination(page, limit, totalComments),
  };
};

const shareTarget = async ({
  targetType,
  targetId,
  recipientIds,
  user,
  req,
  io,
}) => {
  const target = await resolveTarget(targetType, targetId);

  const uniqueRecipientIds = [
    ...new Set(
      (recipientIds || []).filter(
        (id) => id.toString() !== user._id.toString(),
      ),
    ),
  ];

  if (uniqueRecipientIds.length === 0) {
    const err = new Error("At least one valid recipient is required");
    err.statusCode = 400;
    throw err;
  }

  const isCampaign = target.targetType === "campaign";
  const sharePayload = {
    targetType: target.targetType,
    targetId: target.targetId,
    sharedBy: user._id,
    sharedWith: uniqueRecipientIds,
  };
  if (!isCampaign) {
    sharePayload.post = target.targetId;
  }

  const newShare = await ShareModel.create(sharePayload);

  const sharedPost = isCampaign
    ? null
    : buildSharedPostPayload(target.doc, target.targetId);
  const sharedCampaign = isCampaign
    ? buildSharedCampaignPayload(target.doc)
    : null;

  await deliverShareMessages({
    user,
    recipientIds: uniqueRecipientIds,
    io,
    sharedPost,
    sharedCampaign,
  });

  setImmediate(async () => {
    const tasks = [
      target.Model.findByIdAndUpdate(target.targetId, {
        $inc: { sharesCount: 1 },
      }),
      trackEngagement(target.targetId, "shares"),
      logActivity(req, {
        userId: user._id,
        action: isCampaign ? "campaign_shared" : "post_shared",
        targetType: isCampaign ? "campaigns" : "posts",
        targetId: target.targetId,
        meta: {
          [isCampaign ? "campaignId" : "postId"]: target.targetId,
          message: `You have shared a ${target.label}`,
          userId: user._id,
          recipientIds: uniqueRecipientIds,
        },
      }),
    ];

    if (target.ownerId?.toString() !== user._id.toString()) {
      tasks.push(
        createNotification({
          recipientId: target.ownerId,
          senderId: user._id,
          type: isCampaign ? "campaign_shared" : "post_shared",
          targetType: isCampaign ? "campaigns" : "posts",
          targetId: target.targetId,
          title: isCampaign ? "Campaign shared" : "Post shared",
          message: `Your ${target.label} has been shared by ${user.firstName} ${user.lastName}`,
          meta: {
            [isCampaign ? "campaignId" : "postId"]: target.targetId,
            userId: user._id,
            recipientIds: uniqueRecipientIds,
          },
        }),
      );
    }

    await Promise.allSettled(tasks);
  });

  return {
    message: `${target.label[0].toUpperCase()}${target.label.slice(1)} shared successfully`,
    share: newShare,
  };
};

const getLikedTargetIds = async (userId, targetType, targetIds) => {
  if (!userId || !targetIds?.length) return new Set();

  const oids = targetIds.map((id) => new mongoose.Types.ObjectId(id));
  const likes = await LikeModel.find({
    userId,
    targetType,
    targetId: { $in: oids },
  }).select("targetId");

  return new Set(likes.map((like) => like.targetId.toString()));
};

module.exports = {
  resolveTarget,
  likeTarget,
  unlikeTarget,
  listLikes,
  createCommentOnTarget,
  deleteCommentOnTarget,
  listComments,
  shareTarget,
  formatComment,
  getLikedTargetIds,
};
