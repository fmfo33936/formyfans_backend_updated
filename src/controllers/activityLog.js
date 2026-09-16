const ActivityLogModel = require("../models/activityLog");
const { parsePagination } = require("../utils/socialHelpers");
const mongoose = require("mongoose");

const getUserActivityLogs = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const { action } = req.query;

    const matchQuery = { userId: new mongoose.Types.ObjectId(req.user.id) };
    if (action) matchQuery.action = action;

    const results = await ActivityLogModel.aggregate([
      { $match: matchQuery },
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
                action: 1,
                targetType: 1,
                targetId: 1,
                meta: 1,
                ipAddress: 1,
                createdAt: 1,
              },
            },
          ],
        },
      },
    ]);

    const data = results[0]?.data || [];
    const totalCount = results[0]?.metadata[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json({
      message: "Activity logs fetched successfully",
      status: "success",
      data: {
        data,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getUserActivityLogs,
};
