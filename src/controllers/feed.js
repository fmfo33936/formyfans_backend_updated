const Post = require("../models/post");
const Follow = require("../models/follow");
const {
  AUTHOR_FIELDS,
  parsePagination,
  buildPagination,
  isLikedByUser,
  sanitizeAuthor,
} = require("../utils/socialHelpers");
const { enrichPostsWithBoosts } = require("../utils/boostLifecycle");

const formatFeedPost = (post, viewerId) => {
  const doc = post.toObject ? post.toObject() : { ...post };
  const boost = doc.boost || null;
  return {
    _id: doc._id,
    authorId: doc.authorId?._id ? doc.authorId._id : doc.authorId,
    author: doc.authorId?._id ? sanitizeAuthor(doc.authorId) : null,
    caption: doc.caption ?? "",
    media: doc.media ?? [],
    likesCount: doc.likesCount ?? 0,
    commentsCount: doc.commentsCount ?? 0,
    sharesCount: doc.sharesCount ?? 0,
    visibility: doc.visibility,
    isLiked: isLikedByUser(doc.likedBy, viewerId),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    boostId: boost?._id || null,
    isBoosted: Boolean(boost),
    boostObjective: boost?.objective || null,
    boost,
  };
};

const getFollowingFeed = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page, limit, skip } = parsePagination(req);

    const following = await Follow.find({ followerId: userId }).select("followingId");
    const followingIds = following.map((f) => f.followingId);

    const authorIds = [userId, ...followingIds];

    const filter = {
      authorId: { $in: authorIds },
      isExclusive: false,
      $or: [
        { visibility: "public" },
        { visibility: "followers" },
        { authorId: userId, visibility: "private" },
      ],
    };

    const [posts, totalPosts] = await Promise.all([
      Post.find(filter)
        .populate("authorId", AUTHOR_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Post.countDocuments(filter),
    ]);

    const enrichedPosts = await enrichPostsWithBoosts(posts, new Date(), userId);

    return res.status(200).json({
      message: "Feed fetched successfully",
      posts: enrichedPosts.map((p) => formatFeedPost(p, userId)),
      pagination: buildPagination(page, limit, totalPosts),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getFollowingFeed,
};
