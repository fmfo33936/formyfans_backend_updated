const NotificationModel = require("../models/notification");
const { parsePagination } = require("../utils/socialHelpers");
const mongoose = require("mongoose");

const getNotificationsCount = async () => {
  try {
    const user = req.user;
    const results = await NotificationModel.countDocuments({
      recipientId: user?._id,
    });

    return res.status(200).json({
      status: "success",
      message: "Notifications fetched successfully",
      data: results,
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

const markAllRead = async (req, res) => {
  try {
    const user = req.user;
    const results = await NotificationModel.updateMany(
      {
        recipientId: user?._id,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: Date.now(),
        },
      },
    );

    return res.status(200).json({
      status: "success",
      message: "Notifications marked as read",
      data: results,
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

const getNotifications = async (req, res) => {
  const { page, limit, skip } = parsePagination(req);

  const results = await NotificationModel.aggregate([
    { $match: { recipientId: new mongoose.Types.ObjectId(req.user.id) } },
    {
      $lookup: {
        from: "users",
        localField: "senderId",
        foreignField: "_id",
        pipeline: [
          {
            $project: {
              _id: 1,
              firstName: 1,
              lastName: 1,
              username: 1,
              image: 1,
            },
          },
        ],
        as: "sender",
      },
    },
    { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "users",
        localField: "recipientId",
        foreignField: "_id",
        pipeline: [
          {
            $project: {
              _id: 1,
              firstName: 1,
              lastName: 1,
              username: 1,
              image: 1,
            },
          },
        ],
        as: "recipient",
      },
    },
    { $unwind: { path: "$recipient", preserveNullAndEmptyArrays: true } },
    { $sort: { createdAt: -1 } },

    {
      $facet: {
        metadata: [{ $count: "total" }],
        unreadMetadata: [{ $match: { isRead: false } }, { $count: "total" }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              sender: 1,
              senderId: 1,
              recipient: 1,
              recipientId: 1,
              type: 1,
              targetType: 1,
              targetId: 1,
              title: 1,
              message: 1,
              meta: 1,
              createdAt: 1,
              isRead: 1,
              readAt: 1,
            },
          },
        ],
      },
    },
  ]);

  const data = results[0]?.data ?? [];
  const totalCount = results[0]?.metadata[0]?.total ?? 0;
  const unreadCount = results[0]?.unreadMetadata[0]?.total ?? 0;
  const totalPages = Math.ceil(totalCount / limit);

  return res.status(200).json({
    status: "success",
    message: "Notifications fetched successfully",
    data,
    unreadCount,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  });
};

module.exports = {
  getNotifications,
  getNotificationsCount,
  markAllRead,
};
