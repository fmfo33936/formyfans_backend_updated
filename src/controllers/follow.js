const Follow = require("../models/follow");
const FollowSuggestionDismiss = require("../models/followSuggestionDismiss");
const User = require("../models/auth");
const { createNotification } = require("../utils/notificationHelper");
const { logActivity } = require("../utils/activityLogger");
const { parsePagination } = require("../utils/socialHelpers");
const { followUserSchema } = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");
const mongoose = require("mongoose");
const { escapeRegex } = require("../utils/helper");

// Function to follow a user
const followUser = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, followUserSchema);
  if (error) return res.status(400).json({ message: error });

  try {
    const { userId } = validatedData;
    const followerId = req.user._id;

    // Prevent self-follow
    if (followerId.toString() === userId.toString()) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    const targetUser = await User.exists({ _id: userId });
    if (!targetUser)
      return res.status(404).json({ message: "Target user not found" });

    const follow = await Follow.create({ followerId, followingId: userId });

    // ✅ Parallel update
    await Promise.all([
      User.findByIdAndUpdate(userId, { $inc: { followersCount: 1 } }),
      User.findByIdAndUpdate(followerId, { $inc: { followingCount: 1 } }),
    ]);

    res.status(201).json({
      status: "success",
      message: "User followed successfully",
      follow: {
        _id: follow._id,
        followerId: follow.followerId,
        followingId: follow.followingId,
        createdAt: follow.createdAt,
      },
    });

    // Notify followed user (exclude self-follow already handled above)
    setImmediate(async () => {
      const tasks = [
        createNotification({
          recipientId: userId,
          senderId: followerId,
          type: "followed",
          targetType: "follows",
          targetId: follow._id,
          title: "New follower",
          message: `${req.user.firstName} ${req.user.lastName} started following you`,
          meta: { followerId, followingId: userId },
        }),
        logActivity(req, {
          userId: followerId,
          action: "followed_user",
          targetType: "users",
          targetId: userId,
          meta: { followId: follow._id, message: "User followed successfully" },
        }),
      ];
      await Promise.allSettled(tasks);
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Already following this user" });
    }
    return res.status(500).json({ message: error.message });
  }
};

const unfollowUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const followerId = req.user._id;

    // Self-unfollow check
    if (followerId.toString() === userId.toString()) {
      return res.status(400).json({ message: "You cannot unfollow yourself" });
    }

    const result = await Follow.deleteOne({
      followerId,
      followingId: userId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Follow relationship not found" });
    }

    // ✅ Counts update
    await Promise.all([
      User.findByIdAndUpdate(userId, { $inc: { followersCount: -1 } }),
      User.findByIdAndUpdate(followerId, { $inc: { followingCount: -1 } }),
    ]);

    res.status(200).json({
      status: "success",
      message: "User unfollowed successfully",
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId: followerId,
        action: "unfollowed_user",
        targetType: "users",
        targetId: userId,
        meta: { message: "User unfollowed successfully" },
      });
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getFollowers = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const { search } = req.query;
    const userId = req.user._id;
    const loggedInUserId = new mongoose.Types.ObjectId(userId);

    const query = {
      followingId: loggedInUserId,
    };

    const searchQuery = {};

    if (search) {
      const safeSearch = escapeRegex(search);
      searchQuery.$or = [
        { "follower.firstName": { $regex: safeSearch, $options: "i" } },
        { "follower.lastName": { $regex: safeSearch, $options: "i" } },
        { "follower.username": { $regex: safeSearch, $options: "i" } },
      ];
    }

    const results = await Follow.aggregate([
      { $match: query },
      {
        $lookup: {
          from: "users",
          localField: "followerId",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                username: 1,
                image: 1,
                role: 1,
              },
            },
          ],
          as: "follower",
        },
      },
      { $unwind: { path: "$follower", preserveNullAndEmptyArrays: true } },
      { $match: searchQuery },
      {
        $lookup: {
          from: "follows",
          let: { followerUserId: "$followerId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$followerId", loggedInUserId] },
                    { $eq: ["$followingId", "$$followerUserId"] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "followBackData",
        },
      },
      {
        $addFields: {
          isFollowing: { $gt: [{ $size: "$followBackData" }, 0] },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                followerId: 1,
                followingId: 1,
                follower: 1,
                isFollowing: 1,
                createdAt: 1,
              },
            },
          ],
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
      message: "Followers fetched successfully",
      data,
      pagination,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getFollowing = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const { search } = req.query;
    const userId = req.user._id;
    const loggedInUserId = new mongoose.Types.ObjectId(userId);

    const query = {
      followerId: loggedInUserId,
    };

    const searchQuery = {};

    if (search) {
      const safeSearch = escapeRegex(search);
      searchQuery.$or = [
        { "following.firstName": { $regex: safeSearch, $options: "i" } },
        { "following.lastName": { $regex: safeSearch, $options: "i" } },
        { "following.username": { $regex: safeSearch, $options: "i" } },
      ];
    }

    const results = await Follow.aggregate([
      { $match: query },
      {
        $lookup: {
          from: "users",
          localField: "followingId",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                username: 1,
                image: 1,
                role: 1,
              },
            },
          ],
          as: "following",
        },
      },
      { $unwind: { path: "$following", preserveNullAndEmptyArrays: true } },
      { $match: searchQuery },
      {
        $lookup: {
          from: "follows",
          let: { followingUserId: "$followingId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$followingId", loggedInUserId] },
                    { $eq: ["$followerId", "$$followingUserId"] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "followBackData",
        },
      },
      {
        $addFields: {
          isFollowing: { $gt: [{ $size: "$followBackData" }, 0] },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                followingId: 1,
                followerId: 1,
                following: 1,
                isFollowing: 1,
                createdAt: 1,
              },
            },
          ],
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
      message: "Following fetched successfully",
      data,
      pagination,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getFollowersSuggestions = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const { search } = req.query;
    const userId = req.user._id;
    const loggedInUserId = new mongoose.Types.ObjectId(userId);

    const dismissedUserIds = await FollowSuggestionDismiss.find({
      userId: loggedInUserId,
    }).distinct("dismissedUserId");

    const query = {
      followingId: loggedInUserId,
      ...(dismissedUserIds.length > 0 && {
        followerId: { $nin: dismissedUserIds },
      }),
    };

    const searchQuery = {};

    if (search) {
      const safeSearch = escapeRegex(search);
      searchQuery.$or = [
        { "follower.firstName": { $regex: safeSearch, $options: "i" } },
        { "follower.lastName": { $regex: safeSearch, $options: "i" } },
        { "follower.username": { $regex: safeSearch, $options: "i" } },
      ];
    }

    const results = await Follow.aggregate([
      { $match: query },
      {
        $lookup: {
          from: "users",
          localField: "followerId",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                username: 1,
                image: 1,
                role: 1,
              },
            },
          ],
          as: "follower",
        },
      },
      { $unwind: { path: "$follower", preserveNullAndEmptyArrays: true } },
      { $match: searchQuery },
      {
        $lookup: {
          from: "follows",
          let: { followerUserId: "$followerId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$followerId", loggedInUserId] },
                    { $eq: ["$followingId", "$$followerUserId"] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "followBackData",
        },
      },
      {
        $addFields: {
          isFollowing: { $gt: [{ $size: "$followBackData" }, 0] },
        },
      },
      { $match: { isFollowing: false } },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                followerId: 1,
                followingId: 1,
                follower: 1,
                isFollowing: 1,
                createdAt: 1,
              },
            },
          ],
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
      message: "Followers fetched successfully",
      data,
      pagination,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const isFollowingUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const followerId = req.user._id;

    const isFollowing = await Follow.exists({
      followerId,
      followingId: userId,
    });
    return res.status(200).json({
      status: "success",
      message: "User is following",
      isFollowing,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  isFollowingUser,
  getFollowersSuggestions,
};
