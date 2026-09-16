const ExclusiveContent = require("../models/post");
const Comment = require("../models/comment");
const User = require("../models/auth");
const {
  AUTHOR_FIELDS,
  parsePagination,
  assertOwner,
  sanitizeAuthor,
  isLikedByUser,
} = require("../utils/socialHelpers");
const mongoose = require("mongoose");
const { logActivity } = require("../utils/activityLogger");
const { buildAggregatePagination } = require("../utils/helper");
const {
  createExclusiveContentSchema,
  updateExclusiveContentSchema,
} = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");

const formatExclusiveContent = async (content, viewerId) => {
  if (!content) return null;

  await content.populate("authorId", AUTHOR_FIELDS);

  const doc = content.toObject ? content.toObject() : { ...content };
  const isLiked = await isLikedByUser(doc._id, viewerId);

  return {
    _id: doc._id,
    authorId: doc.authorId?._id ? sanitizeAuthor(doc.authorId) : doc.authorId,
    author: doc.authorId?._id ? sanitizeAuthor(doc.authorId) : null,
    caption: doc.caption ?? "",
    title: doc.title ?? "",
    media: doc.media ?? [],
    likesCount: doc.likesCount ?? 0,
    commentsCount: doc.commentsCount ?? 0,
    sharesCount: doc.sharesCount ?? 0,
    visibility: doc.visibility,
    isLiked,
    isExclusive: doc.isExclusive,
    tags: doc.tags ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const createExclusiveContent = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    createExclusiveContentSchema,
  );
  if (error) return res.status(400).json({ status: "error", message: error });
  try {
    const userId = req.user._id;

    const content = await ExclusiveContent.create({
      authorId: userId,
      ...validatedData,
    });

    const formattedContent = await formatExclusiveContent(content, userId);

    res.status(200).json({
      status: "success",
      message: "Exclusive content created successfully",
      post: formattedContent,
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId,
        action: "exclusive_content_created",
        targetType: "posts",
        targetId: content._id,
        meta: {
          message: "Exclusive content created successfully",
        },
      });
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

const updateExclusiveContent = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    updateExclusiveContentSchema,
  );
  if (error) return res.status(400).json({ status: "error", message: error });

  try {
    const userId = req.user._id;
    const { id } = req.params;

    const content = await ExclusiveContent.findById(id);

    if (!content) {
      return res.status(404).json({
        status: "error",
        message: "Exclusive content not found",
      });
    }

    const ownershipError = assertOwner(content.authorId, userId);
    if (ownershipError) {
      return res.status(403).json({
        status: "error",
        message: ownershipError,
      });
    }

    const updatedContent = await ExclusiveContent.findByIdAndUpdate(
      id,
      validatedData,
      {
        new: true,
      },
    );

    const formattedContent = await formatExclusiveContent(
      updatedContent,
      userId,
    );

    res.status(200).json({
      status: "success",
      message: "Exclusive content updated successfully",
      post: formattedContent,
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId,
        action: "exclusive_content_updated",
        targetType: "posts",
        targetId: content._id,
        meta: {
          message: "Exclusive content updated successfully",
        },
      });
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

const deleteExclusiveContent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const content = await ExclusiveContent.findById(id);
    if (!content) {
      return res.status(404).json({
        status: "error",
        message: "Exclusive content not found",
      });
    }

    const ownershipError = assertOwner(content.authorId, userId);
    if (ownershipError) {
      return res.status(403).json({
        status: "error",
        message: ownershipError,
      });
    }

    await Comment.deleteMany({ postId: content._id });
    await ExclusiveContent.deleteOne({ _id: content._id });

    res.status(200).json({
      status: "success",
      message: "Exclusive content deleted successfully",
    });
    setImmediate(async () => {
      await logActivity(req, {
        userId,
        action: "exclusive_content_deleted",
        targetType: "posts",
        targetId: content._id,
        meta: {
          message: "Exclusive content deleted successfully",
        },
      });
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

const getUserExclusiveContentByUsername = async (req, res) => {
  const { username } = req.params;

  const { page, limit, skip } = parsePagination(req);

  try {
    // verify user
    const viewerId = req.user?._id || null;
    const viewerObjectId = viewerId
      ? new mongoose.Types.ObjectId(viewerId)
      : null;

    const user = await User.findOne({ username }).select("_id");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const results = await ExclusiveContent.aggregate([
      {
        $match: {
          status: "published",
          isExclusive: true,
          authorId: new mongoose.Types.ObjectId(user._id),
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "authorId",
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
          as: "author",
        },
      },
      {
        $unwind: {
          path: "$author",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "likes",
          let: { contentId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$contentId", "$$contentId"] },
                    { $eq: ["$userId", viewerObjectId] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "likeData",
        },
      },
      {
        $addFields: {
          isLiked: viewerObjectId
            ? { $gt: [{ $size: "$likeData" }, 0] }
            : false,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                authorId: 1,
                author: 1,
                title: 1,
                caption: 1,
                tags: 1,
                media: 1,
                likesCount: 1,
                commentsCount: 1,
                sharesCount: 1,
                visibility: 1,
                isExclusive: 1,
                createdAt: 1,
                updatedAt: 1,
                isLiked: 1,
                status: 1,
                publishedAt: 1,
              },
            },
          ],
        },
      },
    ]);

    // const { data, pagination } = buildAggregatePagination(req, results);

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
      message: "Exclusive content fetched successfully",
      data,
      pagination,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

const getAllExclusiveContent = async (req, res) => {
  const { page, limit, skip } = parsePagination(req);

  try {
    const viewerId = req.user?._id || null;
    const viewerObjectId = viewerId
      ? new mongoose.Types.ObjectId(viewerId)
      : null;

    const results = await ExclusiveContent.aggregate([
      {
        $match: {
          status: "published",
          isExclusive: true,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "authorId",
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
          as: "author",
        },
      },
      {
        $unwind: {
          path: "$author",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "likes",
          let: { contentId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$contentId", "$$contentId"] },
                    { $eq: ["$userId", viewerObjectId] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "likeData",
        },
      },
      {
        $addFields: {
          isLiked: viewerObjectId
            ? { $gt: [{ $size: "$likeData" }, 0] }
            : false,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                authorId: 1,
                author: 1,
                title: 1,
                caption: 1,
                tags: 1,
                media: 1,
                likesCount: 1,
                commentsCount: 1,
                sharesCount: 1,
                visibility: 1,
                isExclusive: 1,
                createdAt: 1,
                updatedAt: 1,
                isLiked: 1,
                status: 1,
                publishedAt: 1,
              },
            },
          ],
        },
      },
    ]);

    // const { data, pagination } = buildAggregatePagination(req, results);
    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata?.[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json({
      status: "success",
      message: "Exclusive content fetched successfully",
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
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

const getExclusiveContentById = async (req, res) => {
  try {
    const { id } = req.params;
    const content = await ExclusiveContent.findById(id);
    if (!content) {
      return res
        .status(404)
        .json({ status: "error", message: "Exclusive conent not found" });
    }

    if (!content.isExclusive) {
      return res
        .status(404)
        .json({ status: "error", message: "Exclusive conent not found" });
    }

    const viewerId = req.user?._id || null;
    const formattedContent = await formatExclusiveContent(content, viewerId);

    return res.status(200).json({
      status: "success",
      message: "Exclusive conent fetched successfully",
      data: formattedContent,
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

module.exports = {
  createExclusiveContent,
  updateExclusiveContent,
  deleteExclusiveContent,
  getUserExclusiveContentByUsername,
  getAllExclusiveContent,
  getExclusiveContentById,
};
