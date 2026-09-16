// controllers/favourite.controller.js
const FavouriteModel = require("../models/favourite");
const UserModel = require("../models/auth");
const { buildPagination } = require("../utils/helper");
const { logActivity } = require("../utils/activityLogger");
const { parsePagination } = require("../utils/socialHelpers");
const { addFavouriteSchema } = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");
const { createNotification } = require("../utils/notificationHelper");
const mongoose = require("mongoose");

// ── Add Favourite ─────────────────────────────────────────────────
const addFavourite = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, addFavouriteSchema);
  if (error) return res.status(400).json({ status: "error", message: error });

  try {
    const userId = req.user._id;
    const { favouriteUserId } = validatedData;

    if (userId.toString() === favouriteUserId.toString()) {
      return res.status(400).json({
        status: "error",
        message: "You cannot favourite yourself",
      });
    }

    const targetUser = await UserModel.exists({ _id: favouriteUserId });
    if (!targetUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    const favourite = await FavouriteModel.create({ userId, favouriteUserId });

    res.status(201).json({
      status: "success",
      message: "Added to favourites",
    });

    setImmediate(async () => {
      await Promise.allSettled([
        createNotification({
          recipientId: favouriteUserId,
          senderId: userId,
          type: "favourited",
          targetType: "favourites",
          targetId: favourite._id,
          title: "New favourite",
          message: `${req.user.firstName} ${req.user.lastName} added you to favourites`,
          meta: { favouriteUserId },
        }),
        logActivity(req, {
          userId,
          action: "favourite_added",
          targetType: "users",
          targetId: favouriteUserId,
          meta: { favouriteUserId, message: "Added to favourites" },
        }),
      ]);
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ status: "error", message: "Already in favourites" });
    }
    return res.status(500).json({ status: "error", message: error.message });
  }
};

// ── Remove Favourite ──────────────────────────────────────────────
const removeFavourite = async (req, res) => {
  try {
    const userId = req.user.id;
    const { favouriteUserId } = req.params;

    const result = await FavouriteModel.deleteOne({ userId, favouriteUserId });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "Favourite not found",
        status: "failed",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Removed from favourites",
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId,
        action: "favourite_removed",
        targetType: "users",
        targetId: favouriteUserId,
        meta: { favouriteUserId, message: "Removed from favourites" },
      });
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ── Get My Favourites ─────────────────────────────────────────────
const getMyFavourites = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page, limit, skip } = parsePagination(req);

    const results = await FavouriteModel.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "favouriteUserId",
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
                createdAt: 1,
                "user._id": 1,
                "user.firstName": 1,
                "user.lastName": 1,
                "user.username": 1,
                "user.image": 1,
                "user.bio": 1,
                "user.followersCount": 1,
                "user.isVerified": 1,
              },
            },
          ],
        },
      },
    ]);

    const { data, pagination } = buildPagination(req, results);

    return res.status(200).json({
      status: "success",
      message: "Favourites fetched successfully",
      data,
      pagination,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = { addFavourite, removeFavourite, getMyFavourites };
