const Post = require("../models/post");
const Comment = require("../models/comment");
const User = require("../models/auth");
const Follow = require("../models/follow");
const Deal = require("../models/deal");
const {
  AUTHOR_FIELDS,
  parsePagination,
  assertOwner,
  sanitizeAuthor,
  isLikedByUser,
} = require("../utils/socialHelpers");
const mongoose = require("mongoose");
const { logActivity } = require("../utils/activityLogger");
const { buildAggregatePagination, escapeRegex } = require("../utils/helper");
const { createPostSchema, updatePostSchema } = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");
const {
  getEligibleCampaignsForUser,
  interleaveCampaignsIntoFeed,
  countCampaignSlotsInRange,
  CAMPAIGN_FEED_INTERVAL,
} = require("../utils/campaignTargeting");
const {
  enrichPostsWithBoosts,
  getActiveBoostForPost,
  getActiveBoostItemsForUser,
  interleaveBoostItemsIntoFeed,
} = require("../utils/boostLifecycle");

const formatPost = async (post, viewerId) => {
  if (!post) return null;

  await post.populate([
    { path: "authorId", select: AUTHOR_FIELDS },
    { path: "collaborators.userId", select: AUTHOR_FIELDS },
    { path: "taggedUsers.userId", select: AUTHOR_FIELDS },
  ]);

  const doc = post.toObject ? post.toObject() : { ...post };
  const isLiked = await isLikedByUser(doc._id, viewerId);
  const activeBoost = await getActiveBoostForPost(doc._id);

  const collaborators = (doc.collaborators ?? []).map((c) => ({
    userId: c.userId?._id ?? c.userId,
    user: c.userId?._id ? sanitizeAuthor(c.userId) : null,
  }));

  const taggedUsers = (doc.taggedUsers ?? []).map((t) => ({
    userId: t.userId?._id ?? t.userId,
    user: t.userId?._id ? sanitizeAuthor(t.userId) : null,
  }));

  return {
    _id: doc._id,
    authorId: doc.authorId?._id ? sanitizeAuthor(doc.authorId) : doc.authorId,
    author: doc.authorId?._id ? sanitizeAuthor(doc.authorId) : null,
    dealId: doc.dealId ?? null,
    contentType: doc.contentType ?? "post",
    collaborators,
    taggedUsers,
    caption: doc.caption ?? "",
    media: doc.media ?? [],
    likesCount: doc.likesCount ?? 0,
    commentsCount: doc.commentsCount ?? 0,
    sharesCount: doc.sharesCount ?? 0,
    visibility: doc.visibility,
    isLiked,
    isExclusive: doc.isExclusive,
    status: doc.status,
    publishedAt: doc.publishedAt,
    boostId: activeBoost?._id || null,
    isBoosted: Boolean(activeBoost),
    boostObjective: activeBoost?.objective || null,
    boost: activeBoost,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const createPost = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, createPostSchema);
  if (error) return res.status(400).json({ status: "error", message: error });

  try {
    const userId = req.user._id;
    const {
      scheduledAt,
      dealId,
      contentType = "post",
      taggedUsers: taggedUserIds = [],
      ...restData
    } = validatedData;

    let status = "published";
    let publishedAt = new Date();

    if (scheduledAt) {
      status = "scheduled";
      publishedAt = null;
    }

    // ---- Collaborative post: validate + register against the deal ----
    let deal = null;
    if (dealId) {
      deal = await Deal.findById(dealId);

      if (!deal) {
        return res
          .status(404)
          .json({ status: "fail", message: "Deal not found" });
      }

      if (deal.receiver.toString() !== userId.toString()) {
        return res.status(403).json({
          status: "fail",
          message: "You are not the receiver of this deal",
        });
      }

      if (deal.status !== "started") {
        // Covers exactly the case you described: deal already completed
        // (or cancelled/paused/etc) by the time the user tries to select it
        return res.status(400).json({
          status: "fail",
          message:
            deal.status === "completed"
              ? "This deal has already been completed"
              : `This deal is not currently active (status: ${deal.status})`,
        });
      }

      const deliverable = deal.deliverables.find((d) => d.type === contentType);
      if (!deliverable) {
        return res.status(400).json({
          status: "fail",
          message: `This deal has no "${contentType}" deliverable`,
        });
      }
      if (deliverable.completed >= deliverable.count) {
        return res.status(400).json({
          status: "fail",
          message: `All "${contentType}" deliverables for this deal are already fulfilled`,
        });
      }
      // if we get here, it's safe to create the post and bump the count
    }

    // ---- Validate + deduplicate tagged user IDs ----
    let validatedTaggedUsers = [];
    if (taggedUserIds.length > 0) {
      const uniqueIds = [...new Set(taggedUserIds)];
      // Filter out self-tagging
      const filteredIds = uniqueIds.filter(
        (id) => id.toString() !== userId.toString(),
      );
      if (filteredIds.length > 0) {
        const existingUsers = await User.find({
          _id: { $in: filteredIds },
        }).select("_id");
        validatedTaggedUsers = existingUsers.map((u) => ({ userId: u._id }));
      }
    }

    const post = await Post.create({
      authorId: userId,
      ...restData,
      contentType,
      dealId: deal?._id || null,
      collaborators: deal ? [{ userId: deal.sender }] : [],
      taggedUsers: validatedTaggedUsers,
      status: status,
      scheduledAt: scheduledAt || null,
      publishedAt,
    });

    // Bump the matching deliverable's completed count now that the post exists
    if (deal) {
      await deal.registerDeliverable(contentType);
    }

    const formattedPost = await formatPost(post, userId);

    res.status(200).json({
      status: "success",
      message:
        status === "scheduled"
          ? "Post scheduled successfully"
          : "Post created successfully",
      post: formattedPost,
    });

    setImmediate(async () => {
      const tasks = [
        logActivity(req, {
          userId,
          action: status === "scheduled" ? "post_scheduled" : "post_created",
          targetType: "posts",
          targetId: post._id,
          meta: {
            message:
              status === "scheduled"
                ? "Post scheduled successfully"
                : "Post created successfully",
          },
        }),
      ];

      // Send tag notifications on immediate publish only. Scheduled posts get
      // theirs from the publish job (jobs/publishScheduledPosts.js), so the
      // tagged user is notified when the post is actually live.
      if (status !== "scheduled" && validatedTaggedUsers.length > 0) {
        const { createNotification } = require("../utils/notificationHelper");
        for (const tagged of validatedTaggedUsers) {
          tasks.push(
            createNotification({
              recipientId: tagged.userId,
              senderId: userId,
              type: "post_tagged",
              targetType: "posts",
              targetId: post._id,
              title: "Tagged in a post",
              message: `${req.user.firstName} ${req.user.lastName} tagged you in a post`,
              meta: { postId: post._id, authorId: userId },
            }),
          );
        }
      }

      await Promise.allSettled(tasks);
    });
  } catch (error) {
    console.error("Create post error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong",
    });
  }
};

const updatePost = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, updatePostSchema);
  if (error) return res.status(400).json({ status: "error", message: error });

  try {
    const userId = req.user._id;
    const { postId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid post ID",
      });
    }

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({
        status: "error",
        message: "Post not found",
      });
    }

    const ownershipError = assertOwner(post.authorId, userId);
    if (ownershipError) {
      return res.status(403).json({
        status: "error",
        message: ownershipError,
      });
    }

    // Don't allow editing a post that's already published
    if (post.status === "published" && validatedData.scheduledAt) {
      return res.status(400).json({
        status: "error",
        message: "Cannot reschedule a post that's already published",
      });
    }

    const updatePayload = { ...validatedData };

    // If updating scheduledAt on a not-yet-published post, keep status in sync
    if (validatedData.scheduledAt) {
      updatePayload.status = "scheduled";
    }

    // Handle taggedUsers validation + dedup on update
    if (validatedData.taggedUsers !== undefined) {
      const taggedUserIds = validatedData.taggedUsers;
      delete updatePayload.taggedUsers; // remove raw IDs from payload
      const uniqueIds = [...new Set(taggedUserIds)];
      const filteredIds = uniqueIds.filter(
        (id) => id.toString() !== userId.toString(),
      );
      if (filteredIds.length > 0) {
        const existingUsers = await User.find({
          _id: { $in: filteredIds },
        }).select("_id");
        updatePayload.taggedUsers = existingUsers.map((u) => ({ userId: u._id }));
      } else {
        updatePayload.taggedUsers = [];
      }
    }

    const updatedPost = await Post.findByIdAndUpdate(postId, updatePayload, {
      new: true,
      runValidators: true,
    });

    const formattedPost = await formatPost(updatedPost, userId);

    res.status(200).json({
      status: "success",
      message: "Post updated successfully",
      post: formattedPost,
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId,
        action: "post_updated",
        targetType: "posts",
        targetId: post._id,
        meta: {
          message: "Post updated successfully",
        },
      });
    });
  } catch (error) {
    console.error("Update post error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong",
    });
  }
};

const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({
        status: "error",
        message: "Post not found",
      });
    }

    const ownershipError = assertOwner(post.authorId, userId);
    if (ownershipError) {
      return res.status(403).json({
        status: "error",
        message: ownershipError,
      });
    }

    await Comment.deleteMany({ postId: post._id });
    await Post.deleteOne({ _id: post._id });

    res.status(200).json({
      status: "success",
      message: "Post deleted successfully",
    });
    setImmediate(async () => {
      await logActivity(req, {
        userId,
        action: "post_deleted",
        targetType: "posts",
        targetId: post._id,
        meta: {
          message: "Post deleted successfully",
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

// const getUserPostsByUsername = async (req, res) => {
//   const { username } = req.params;
//   const { status = "published" } = req.query;

//   const { page, limit, skip } = parsePagination(req);

//   try {
//     // verify user
//     const viewerId = req.user?._id || null;
//     const viewerObjectId = viewerId
//       ? new mongoose.Types.ObjectId(viewerId)
//       : null;

//     const user = await User.findOne({ username }).select("_id");
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     const filter = {
//       isExclusive: false,
//       authorId: new mongoose.Types.ObjectId(user._id),
//     };

//     if (status) {
//       filter.status = status;
//     }

//     const results = await Post.aggregate([
//       {
//         $match: {
//           ...filter,
//         },
//       },
//       {
//         $lookup: {
//           from: "users",
//           localField: "authorId",
//           foreignField: "_id",
//           pipeline: [
//             {
//               $project: {
//                 _id: 1,
//                 firstName: 1,
//                 lastName: 1,
//                 username: 1,
//                 image: 1,
//                 role: 1,
//               },
//             },
//           ],
//           as: "author",
//         },
//       },
//       {
//         $unwind: {
//           path: "$author",
//           preserveNullAndEmptyArrays: true,
//         },
//       },
//       {
//         $lookup: {
//           from: "likes",
//           let: { postId: "$_id" },
//           pipeline: [
//             {
//               $match: {
//                 $expr: {
//                   $and: [
//                     { $eq: ["$postId", "$$postId"] },
//                     { $eq: ["$userId", viewerObjectId] },
//                   ],
//                 },
//               },
//             },
//             { $limit: 1 },
//           ],
//           as: "likeData",
//         },
//       },
//       {
//         $addFields: {
//           isLiked: viewerObjectId
//             ? { $gt: [{ $size: "$likeData" }, 0] }
//             : false,
//         },
//       },
//       {
//         $sort: { createdAt: -1 },
//       },
//       {
//         $facet: {
//           metadata: [{ $count: "total" }],
//           data: [
//             { $skip: skip },
//             { $limit: limit },
//             {
//               $project: {
//                 _id: 1,
//                 authorId: 1,
//                 author: 1,
//                 caption: 1,
//                 media: 1,
//                 likesCount: 1,
//                 commentsCount: 1,
//                 sharesCount: 1,
//                 visibility: 1,
//                 isExclusive: 1,
//                 createdAt: 1,
//                 updatedAt: 1,
//                 isLiked: 1,
//                 status: 1,
//                 publishedAt: 1,
//               },
//             },
//           ],
//         },
//       },
//     ]);

//     // const { data, pagination } = buildAggregatePagination(req, results);

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
//       message: "Posts fetched successfully",
//       data,
//       pagination,
//     });
//   } catch (error) {
//     return res.status(500).json({
//       status: "error",
//       message: error.message,
//     });
//   }
// };

// const getAllPosts = async (req, res) => {
//   const { page, limit, skip } = parsePagination(req);

//   try {
//     const viewerId = req.user?._id || null;
//     const viewerObjectId = viewerId
//       ? new mongoose.Types.ObjectId(viewerId)
//       : null;

//     const filter = {
//       isExclusive: false,
//       status: "published",
//     };

//     const results = await Post.aggregate([
//       {
//         $match: {
//           ...filter,
//         },
//       },
//       {
//         $lookup: {
//           from: "users",
//           localField: "authorId",
//           foreignField: "_id",
//           pipeline: [
//             {
//               $project: {
//                 _id: 1,
//                 firstName: 1,
//                 lastName: 1,
//                 username: 1,
//                 image: 1,
//                 role: 1,
//               },
//             },
//           ],
//           as: "author",
//         },
//       },
//       {
//         $unwind: {
//           path: "$author",
//           preserveNullAndEmptyArrays: true,
//         },
//       },
//       {
//         $lookup: {
//           from: "likes",
//           let: { postId: "$_id" },
//           pipeline: [
//             {
//               $match: {
//                 $expr: {
//                   $and: [
//                     { $eq: ["$postId", "$$postId"] },
//                     { $eq: ["$userId", viewerObjectId] },
//                   ],
//                 },
//               },
//             },
//             { $limit: 1 },
//           ],
//           as: "likeData",
//         },
//       },
//       {
//         $addFields: {
//           isLiked: viewerObjectId
//             ? { $gt: [{ $size: "$likeData" }, 0] }
//             : false,
//         },
//       },
//       {
//         $sort: { createdAt: -1 },
//       },
//       {
//         $facet: {
//           metadata: [{ $count: "total" }],
//           data: [
//             { $skip: skip },
//             { $limit: limit },
//             {
//               $project: {
//                 _id: 1,
//                 authorId: 1,
//                 author: 1,
//                 caption: 1,
//                 media: 1,
//                 likesCount: 1,
//                 commentsCount: 1,
//                 sharesCount: 1,
//                 visibility: 1,
//                 isExclusive: 1,
//                 createdAt: 1,
//                 updatedAt: 1,
//                 isLiked: 1,
//                 status: 1,
//                 publishedAt: 1,
//               },
//             },
//           ],
//         },
//       },
//     ]);

//     // const { data, pagination } = buildAggregatePagination(req, results);
//     const data = results[0]?.data ?? [];
//     const totalCount = results[0].metadata[0]?.total ?? 0;
//     const totalPages = Math.ceil(totalCount / limit);

//     return res.status(200).json({
//       status: "success",
//       message: "Posts fetched successfully",
//       data,
//       pagination: {
//         page,
//         limit,
//         totalCount,
//         totalPages,
//         hasNextPage: page < totalPages,
//         hasPrevPage: page > 1,
//       },
//     });
//   } catch (error) {
//     return res.status(500).json({
//       status: "error",
//       message: error.message,
//     });
//   }
// };

const getUserPostsByUsername = async (req, res) => {
  const { username } = req.params;
  const { status = "published" } = req.query;

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

    const filter = {
      isExclusive: false,
      $or: [
        { authorId: new mongoose.Types.ObjectId(user._id) },
        { "collaborators.userId": new mongoose.Types.ObjectId(user._id) },
        { "taggedUsers.userId": new mongoose.Types.ObjectId(user._id) },
      ],
    };

    if (status) {
      filter.status = status;
    }

    const results = await Post.aggregate([
      {
        $match: {
          ...filter,
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
      // ---- Populate collaborators (only relevant when the post came from a deal) ----
      {
        $lookup: {
          from: "users",
          localField: "collaborators.userId",
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
          as: "collaboratorUsers",
        },
      },

      // ---- Populate taggedUsers (Facebook-style "with X") ----
      {
        $lookup: {
          from: "users",
          localField: "taggedUsers.userId",
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
          as: "taggedUsersData",
        },
      },
      {
        $addFields: {
          taggedUsers: {
            $map: {
              input: { $ifNull: ["$taggedUsers", []] },
              as: "tag",
              in: {
                userId: "$$tag.userId",
                user: {
                  $first: {
                    $filter: {
                      input: "$taggedUsersData",
                      as: "u",
                      cond: { $eq: ["$$u._id", "$$tag.userId"] },
                    },
                  },
                },
              },
            },
          },
        },
      },

      {
        $addFields: {
          collaborators: {
            $map: {
              input: { $ifNull: ["$collaborators", []] },
              as: "collab",
              in: {
                userId: "$$collab.userId",
                user: {
                  $first: {
                    $filter: {
                      input: "$collaboratorUsers",
                      as: "u",
                      cond: { $eq: ["$$u._id", "$$collab.userId"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "likes",
          let: { postId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$postId", "$$postId"] },
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
                caption: 1,
                media: 1,
                dealId: 1,
                contentType: 1,
                collaborators: 1,
                taggedUsers: 1,
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

    const posts = results[0]?.data ?? [];
    const data = await enrichPostsWithBoosts(posts, new Date(), viewerId);
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
      message: "Posts fetched successfully",
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

const getAllPosts = async (req, res) => {
  const { page, limit, skip } = parsePagination(req);

  try {
    const viewerId = req.user?._id || null;
    const viewerObjectId = viewerId
      ? new mongoose.Types.ObjectId(viewerId)
      : null;

    const filter = {
      isExclusive: false,
      status: "published",
    };

    
    if (req.query.mine === "true") {
      filter.authorId = viewerObjectId;
    }

    const results = await Post.aggregate([
      {
        $match: {
          ...filter,
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
      // ---- Populate collaborators (only relevant when the post came from a deal) ----
      {
        $lookup: {
          from: "users",
          localField: "collaborators.userId",
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
          as: "collaboratorUsers",
        },
      },

      // ---- Populate taggedUsers (Facebook-style "with X") ----
      {
        $lookup: {
          from: "users",
          localField: "taggedUsers.userId",
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
          as: "taggedUsersData",
        },
      },
      {
        $addFields: {
          taggedUsers: {
            $map: {
              input: { $ifNull: ["$taggedUsers", []] },
              as: "tag",
              in: {
                userId: "$$tag.userId",
                user: {
                  $first: {
                    $filter: {
                      input: "$taggedUsersData",
                      as: "u",
                      cond: { $eq: ["$$u._id", "$$tag.userId"] },
                    },
                  },
                },
              },
            },
          },
        },
      },

      {
        $addFields: {
          collaborators: {
            $map: {
              input: "$collaborators",
              as: "collab",
              in: {
                userId: "$$collab.userId",
                user: {
                  $first: {
                    $filter: {
                      input: "$collaboratorUsers",
                      as: "u",
                      cond: { $eq: ["$$u._id", "$$collab.userId"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "likes",
          let: { postId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$postId", "$$postId"] },
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
                caption: 1,
                media: 1,
                dealId: 1,
                contentType: 1,
                collaborators: 1,
                taggedUsers: 1,
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

    const posts = results[0]?.data ?? [];
    const enrichedPosts = await enrichPostsWithBoosts(posts, new Date(), viewerId, {
      // Creator's own "mine" feed (Boost Posts page) shows a post as boosted
      // whenever an active boost exists, independent of audience targeting.
      audienceCheck: req.query.mine !== "true",
    });
    const totalCount = results[0].metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    let followingAuthorIds = new Set();
    if (viewerId) {
      const boostedPostsInFeed = enrichedPosts.filter((p) => p.isBoosted && p.authorId);
      const authorIds = [
        ...new Set(boostedPostsInFeed.map((p) => p.authorId?._id?.toString() || p.authorId?.toString()).filter(Boolean)),
      ].map((id) => new mongoose.Types.ObjectId(id));

      if (authorIds.length > 0) {
        const followDocs = await Follow.find({
          followerId: new mongoose.Types.ObjectId(viewerId),
          followingId: { $in: authorIds },
        }).select("followingId").lean();
        followingAuthorIds = new Set(followDocs.map((doc) => doc.followingId.toString()));
      }
    }

    const enrichedWithFollow = enrichedPosts.map((post) => {
      if (!post.isBoosted || !post.author) return post;
      const authorId = post.author?._id?.toString();
      return {
        ...post,
        author: {
          ...post.author,
          isFollowing: followingAuthorIds.has(authorId),
        },
      };
    });

    let data = enrichedWithFollow.map((post) => ({ ...post, itemType: "post" }));
    let campaignsInjected = false;

    if (viewerId) {
      // Global post stream index so ads stay every N posts across pages
      // (page2 continues the cycle from where page1 left off).
      const globalPostStart = (page - 1) * limit;
      const campaignsNeeded = countCampaignSlotsInRange(
        globalPostStart,
        posts.length,
        CAMPAIGN_FEED_INTERVAL,
      );
      const campaignSkip = Math.floor(
        globalPostStart / CAMPAIGN_FEED_INTERVAL,
      );

      const campaigns =
        campaignsNeeded > 0
          ? await getEligibleCampaignsForUser(viewerId, {
              limit: campaignsNeeded,
              skip: campaignSkip,
              viewerId,
            })
          : [];

      if (campaigns.length > 0) {
        data = interleaveCampaignsIntoFeed(
          enrichedPosts,
          campaigns,
          CAMPAIGN_FEED_INTERVAL,
          { postsAlreadyCounted: globalPostStart % CAMPAIGN_FEED_INTERVAL },
        );
        campaignsInjected = true;
      }
    }

    // Inject eligible boosted posts every 6 posts across the feed
    if (viewerId) {
      try {
        const boostItems = await getActiveBoostItemsForUser(viewerId);
        if (boostItems.length > 0) {
          const globalPostStart = (page - 1) * limit;
          data = await interleaveBoostItemsIntoFeed(
            data,
            boostItems,
            globalPostStart,
            viewerId,
          );
        }
      } catch (boostErr) {
        console.error("Boost recurrence error:", boostErr.message);
      }
    }

    return res.status(200).json({
      status: "success",
      message: "Posts fetched successfully",
      data,
      campaignsInjected,
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

const getSheduledPost = async (req, res) => {
  const { page, limit, skip } = parsePagination(req);
  const { startDate = "", endDate = "" } = req.query;

  try {
    const viewerId = req.user?._id || null;
    const viewerObjectId = viewerId
      ? new mongoose.Types.ObjectId(viewerId)
      : null;

    const filter = {
      isExclusive: false,
      status: "scheduled",
    };

    if (startDate && endDate) {
      const sd = new Date(startDate);
      const ed = new Date(endDate);
      sd.setHours(0, 0, 0, 0);
      ed.setHours(23, 59, 59, 999);
      filter.scheduledAt = { $gte: sd, $lt: ed };
    }

    const results = await Post.aggregate([
      { $match: { ...filter } },
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
      { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },

      // ✅ Collaborators lookup added
      {
        $lookup: {
          from: "users",
          localField: "collaborators.userId",
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
          as: "collaboratorUsers",
        },
      },

      // ---- Populate taggedUsers (Facebook-style "with X") ----
      {
        $lookup: {
          from: "users",
          localField: "taggedUsers.userId",
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
          as: "taggedUsersData",
        },
      },
      {
        $addFields: {
          taggedUsers: {
            $map: {
              input: { $ifNull: ["$taggedUsers", []] },
              as: "tag",
              in: {
                userId: "$$tag.userId",
                user: {
                  $first: {
                    $filter: {
                      input: "$taggedUsersData",
                      as: "u",
                      cond: { $eq: ["$$u._id", "$$tag.userId"] },
                    },
                  },
                },
              },
            },
          },
        },
      },

      {
        $addFields: {
          collaborators: {
            $map: {
              input: { $ifNull: ["$collaborators", []] },
              as: "c",
              in: {
                userId: "$$c.userId",
                user: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$collaboratorUsers",
                        as: "u",
                        cond: { $eq: ["$$u._id", "$$c.userId"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
      },

      {
        $lookup: {
          from: "likes",
          let: { postId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$postId", "$$postId"] },
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
                authorId: 1,
                author: 1,
                collaborators: 1, // ✅ added
                taggedUsers: 1,
                caption: 1,
                media: 1,
                likesCount: 1,
                commentsCount: 1,
                sharesCount: 1,
                visibility: 1,
                isExclusive: 1,
                createdAt: 1,
                updatedAt: 1,
                isLiked: 1,
                scheduledAt: 1,
                status: 1,
              },
            },
          ],
        },
      },
    ]);

    const posts = results[0]?.data ?? [];
    const data = await enrichPostsWithBoosts(posts, new Date(), viewerId);
    const totalCount = results[0].metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json({
      status: "success",
      message: "Posts fetched successfully",
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
    return res.status(500).json({ status: "error", message: error.message });
  }
};

const getUpcomingScheduledPosts = async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = 10;
    const now = new Date();

    const posts = await Post.aggregate([
      {
        $match: {
          authorId: new mongoose.Types.ObjectId(userId),
          status: "scheduled",
          scheduledAt: { $gte: now },
        },
      },
      { $sort: { scheduledAt: 1 } },
      { $limit: limit },
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
      { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },

      // ✅ Collaborators lookup added
      {
        $lookup: {
          from: "users",
          localField: "collaborators.userId",
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
          as: "collaboratorUsers",
        },
      },

      // ---- Populate taggedUsers (Facebook-style "with X") ----
      {
        $lookup: {
          from: "users",
          localField: "taggedUsers.userId",
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
          as: "taggedUsersData",
        },
      },
      {
        $addFields: {
          taggedUsers: {
            $map: {
              input: { $ifNull: ["$taggedUsers", []] },
              as: "tag",
              in: {
                userId: "$$tag.userId",
                user: {
                  $first: {
                    $filter: {
                      input: "$taggedUsersData",
                      as: "u",
                      cond: { $eq: ["$$u._id", "$$tag.userId"] },
                    },
                  },
                },
              },
            },
          },
        },
      },

      {
        $addFields: {
          collaborators: {
            $map: {
              input: { $ifNull: ["$collaborators", []] },
              as: "c",
              in: {
                userId: "$$c.userId",
                user: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$collaboratorUsers",
                        as: "u",
                        cond: { $eq: ["$$u._id", "$$c.userId"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
      },

      {
        $project: {
          _id: 1,
          authorId: 1,
          author: 1,
          collaborators: 1,
          taggedUsers: 1,
          caption: 1,
          media: 1,
          visibility: 1,
          isExclusive: 1,
          status: 1,
          scheduledAt: 1,
          createdAt: 1,
          updatedAt: 1,
          dealId: 1,
        },
      },
    ]);

    const data = await enrichPostsWithBoosts(posts, new Date(), userId);

    return res.status(200).json({
      status: "success",
      message: "Upcoming scheduled posts fetched successfully",
      data,
    });
  } catch (error) {
    console.error("Get upcoming scheduled posts error:", error);
    return res
      .status(500)
      .json({ status: "error", message: "Something went wrong" });
  }
};

const getPostById = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId);
    if (!post) {
      return res
        .status(404)
        .json({ status: "error", message: "Post not found" });
    }

    if (post.isExclusive) {
      return res
        .status(404)
        .json({ status: "error", message: "Post not found" });
    }

    const formattedPost = await formatPost(post, req.user._id);

    return res.status(200).json({
      status: "success",
      message: "Post fetched successfully",
      data: formattedPost,
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

// Search users (followers + following) for tagging in posts
const searchTaggableUsers = async (req, res) => {
  try {
    const userId = req.user._id;
    const { search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Get follower IDs and following IDs via aggregation
    const [followerResult, followingResult] = await Promise.all([
      Follow.aggregate([
        { $match: { followingId: userObjectId } },
        { $project: { userId: "$followerId" } },
      ]),
      Follow.aggregate([
        { $match: { followerId: userObjectId } },
        { $project: { userId: "$followingId" } },
      ]),
    ]);

    // Merge + deduplicate user IDs
    const allIds = [
      ...new Set([
        ...followerResult.map((r) => r.userId.toString()),
        ...followingResult.map((r) => r.userId.toString()),
      ]),
    ].map((id) => new mongoose.Types.ObjectId(id));

    if (allIds.length === 0) {
      return res.status(200).json({
        status: "success",
        data: [],
        pagination: { page: pageNum, limit: limitNum, totalCount: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
      });
    }

    // Build search filter
    const matchQuery = { _id: { $in: allIds } };
    if (search && search.trim()) {
      const safeSearch = escapeRegex(search.trim());
      matchQuery.$or = [
        { firstName: { $regex: safeSearch, $options: "i" } },
        { lastName: { $regex: safeSearch, $options: "i" } },
        { username: { $regex: safeSearch, $options: "i" } },
      ];
    }

    const [users, countResult] = await Promise.all([
      User.find(matchQuery)
        .select("firstName lastName username image role")
        .sort({ firstName: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(matchQuery),
    ]);

    const totalCount = countResult;
    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      status: "success",
      data: users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("Search taggable users error:", error);
    return res.status(500).json({ status: "error", message: error.message });
  }
};

module.exports = {
  createPost,
  updatePost,
  deletePost,
  getUserPostsByUsername,
  getAllPosts,
  getPostById,
  getSheduledPost,
  getUpcomingScheduledPosts,
  searchTaggableUsers,
};
