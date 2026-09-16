const LikeModel = require("../models/like");


const AUTHOR_FIELDS = "firstName lastName email role image username";

const parsePagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 1000);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const buildPagination = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit) || 1;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

const assertOwner = (authorId, userId) => {
  if (String(authorId) !== String(userId)) {
    return "You can only perform this action on your own content";
  }
  return null;
};

const sanitizeAuthor = (author) => {
  if (!author) return null;
  const doc = author.toObject ? author.toObject() : author;
  return {
    _id: doc._id,
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    username: doc.username,
    image: doc.image || "",
    role: doc.role,
  };
};

// const isLikedByUser = (likedBy, userId) => {
//   if (!likedBy || !userId) return false;
//   return likedBy.some((id) => String(id) === String(userId));
// };

// const isLikedByUserAggregate = (likedBy, userId) => {
//   if (!likedBy || !userId) return false;
//   return likedBy.some((id) => id === userId);
// };

const VALID_MEDIA_TYPES = ["image", "video", "gif"];

const normalizePostMedia = (media) => {
  if (!Array.isArray(media)) {
    return { error: "media must be an array" };
  }

  const normalized = [];
  for (const item of media) {
    const url = item?.url != null ? String(item.url).trim() : "";
    const mediaType = item?.mediaType;

    if (!url) {
      return { error: "Each media item must include a url" };
    }
    if (!VALID_MEDIA_TYPES.includes(mediaType)) {
      return { error: "Each media item mediaType must be image, video, or gif" };
    }

    normalized.push({ url, mediaType });
  }

  return { media: normalized };
};

const buildAllPostsFilter = async (viewerId, Follow) => {
  if (!viewerId) {
    return { visibility: "public" };
  }

  const following = await Follow.find({ followerId: viewerId }).select("followingId");
  const followingIds = following.map((f) => f.followingId);

  return {
    $or: [
      { visibility: "public" },
      { visibility: "followers", authorId: { $in: followingIds } },
      { authorId: viewerId },
    ],
  };
};

const canViewPost = async (post, viewerId, Follow) => {
  if (!post) return false;

  const authorId = String(post.authorId?._id || post.authorId);
  const viewer = viewerId ? String(viewerId) : null;

  if (post.visibility === "public") return true;
  if (!viewer) return false;
  if (authorId === viewer) return true;
  if (post.visibility === "private") return false;

  if (post.visibility === "followers") {
    const follow = await Follow.findOne({
      followerId: viewer,
      followingId: authorId,
    });
    return Boolean(follow);
  }

  return false;
};

const isLikedByUser = async (postId, userId) => {
  if (!userId) return false;
  const liked = await LikeModel.exists({ postId, userId });
  return !!liked;
};

module.exports = {
  AUTHOR_FIELDS,
  parsePagination,
  buildPagination,
  assertOwner,
  sanitizeAuthor,
  isLikedByUser,
  normalizePostMedia,
  buildAllPostsFilter,
  canViewPost,
  VALID_MEDIA_TYPES,
};
