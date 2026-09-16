const MediaModel = require("../models/media");
const { uploadMediaSchema } = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");
const UserModel = require("../models/auth");
const { parsePagination } = require("../utils/socialHelpers");
const mongoose = require("mongoose");
const { logActivity } = require("../utils/activityLogger");

const uploadMedia = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, uploadMediaSchema);
  if (error) return res.status(400).json({ message: error });
  try {
    // const { url, publicId, type, thumbnail, caption, size, duration } = validatedData;
    const userId = req.user._id;

    const media = await MediaModel.create({
      ...validatedData,
      userId,
    });

    const countField =
      validatedData.type === "photo" ? "photosCount" : "videosCount";
    await UserModel.findByIdAndUpdate(userId, { $inc: { [countField]: 1 } });

    res.status(201).json({
      status: "success",
      message: `${validatedData.type} uploaded successfully`,
      data: media,
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId,
        action:
          validatedData.type === "photo" ? "photo_uploaded" : "video_uploaded",
        targetType: "media",
        targetId: media._id,
        meta: {
          mediaType: validatedData.type,
          message: `${validatedData.type} uploaded successfully`,
        },
      });
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getMediaByUsername = async (req, res) => {
  const { username } = req.params;
  const { page, limit, skip } = parsePagination(req);
  const { type } = req.query;
  try {
    const user = await UserModel.findOne({ username }).select("_id");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const filter = {
      userId: new mongoose.Types.ObjectId(user._id),
    };

    if (type) {
      filter.type = type;
    }

    const results = await MediaModel.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                _id: 1,
                username: 1,
                firstName: 1,
                lastName: 1,
                image: 1,
              },
            },
          ],
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
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
                url: 1,
                publicId: 1,
                size: 1,
                duration: 1,
                thumbnail: 1,
                thumbnailPublicId: 1,
                type: 1,
                createdAt: 1,
                updatedAt: 1,
                user: 1,
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
      status: "success",
      message: "Media fetched successfully",
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

const deleteMedia = async (req, res) => {
  const { id } = req.params;
  try {
    const media = await MediaModel.findByIdAndDelete(id);
    if (!media) {
      return res.status(404).json({ message: "Media not found" });
    }

    const userId = req.user._id;
    const countField = media.type === "photo" ? "photosCount" : "videosCount";
    await UserModel.findByIdAndUpdate(userId, { $inc: { [countField]: -1 } });

    res.status(200).json({
      status: "success",
      message: "Media deleted successfully",
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId,
        action: "media_deleted",
        targetType: "media",
        targetId: media._id,
        meta: {
          mediaType: media.type,
          message: "Media deleted successfully",
        },
      });
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  uploadMedia,
  getMediaByUsername,
  deleteMedia,
};
