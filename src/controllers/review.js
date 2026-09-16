const ReviewModel = require("../models/review");
const UserModel = require("../models/auth");
const mongoose = require("mongoose");
const { parsePagination } = require("../utils/socialHelpers");

const getReviewsByCreatorId = async (req, res) => {
  const { creatorId } = req.params;
  const { page, limit, skip } = parsePagination(req);

  try {
    if (!mongoose.Types.ObjectId.isValid(creatorId)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid creator id",
      });
    }

    const user = await UserModel.exists({
      _id: new mongoose.Types.ObjectId(creatorId),
    });

    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "Creator not found",
      });
    }

    const results = await ReviewModel.aggregate([
      {
        $match: {
          reviewee: new mongoose.Types.ObjectId(creatorId),
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "reviewer",
          foreignField: "_id",
          as: "reviewer",
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
          path: "$reviewer",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $sort: {
          createdAt: -1,
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
    const totalCount = results[0]?.metadata?.[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json({
      status: "success",
      message: "Reviews fetched successfully",
      data,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    console.error("getReviewsByCreatorId error:", err);
    return res.status(500).json({
      status: "fail",
      message: err.message,
    });
  }
};

module.exports = {
  getReviewsByCreatorId,
};
