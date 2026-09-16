const mongoose = require("mongoose");
const Boost = require("../models/boost");
const Post = require("../models/post");
const PostImpression = require("../models/postImpression");
const User = require("../models/auth");
const Follow = require("../models/follow");
const { getUserAgeYears } = require("./campaignTargeting");
const { AUTHOR_FIELDS } = require("./socialHelpers");
const { getLikedTargetIds } = require("./engagementHelper");

const ACTIVE_STATUS = "active";
const ACTIVE_BOOST_FIELDS =
  "_id postId objective startDate endDate duration budget perDayBudget estimatedReach websiteUrl";
const BOOST_REPEAT_INTERVAL = 6;

const toIdString = (value) => (value == null ? "" : String(value));

const serializeBoost = (boost) => {
  if (!boost) return null;

  const doc = boost.toObject ? boost.toObject() : boost;
  return {
    _id: doc._id,
    postId: doc.postId,
    objective: doc.objective,
    startDate: doc.startDate,
    endDate: doc.endDate,
    duration: doc.duration,
    budget: doc.budget,
    perDayBudget: doc.perDayBudget,
    estimatedReach: doc.estimatedReach,
    websiteUrl: doc.websiteUrl || null,
    audience: doc.audience || null,
    audienceMode: doc.audienceMode || null,
  };
};

const activeBoostFilter = (postIds, now = new Date()) => ({
  postId: { $in: postIds },
  status: ACTIVE_STATUS,
  endDate: { $gt: now },
});

const expireDueBoosts = async (now = new Date()) => {
  const dueBoosts = await Boost.find({
    status: ACTIVE_STATUS,
    endDate: { $lte: now },
  }).select("_id postId");

  let completedCount = 0;
  for (const boost of dueBoosts) {
    const completed = await Boost.findOneAndUpdate(
      { _id: boost._id, status: ACTIVE_STATUS, endDate: { $lte: now } },
      { $set: { status: "completed" } },
      { new: true },
    );

    if (completed) {
      completedCount += 1;
      await syncPostBoostMarker(boost.postId, { expectedBoostId: boost._id });
    }
  }

  return completedCount;
};

const getActiveBoostForPost = async (postId, now = new Date()) => {
  if (!mongoose.Types.ObjectId.isValid(postId)) return null;

  const boost = await Boost.findOne({
    postId,
    status: ACTIVE_STATUS,
    endDate: { $gt: now },
  })
    .select(ACTIVE_BOOST_FIELDS)
    .sort({ startDate: -1, createdAt: -1 });

  return serializeBoost(boost);
};

const checkAudienceMatch = (boost, viewer) => {
  if (!viewer) return false; // anonymous = no match
  const audience = boost.audience || {};

  const viewerAge = getUserAgeYears(viewer.dateOfBirth);
  const viewerCountry = viewer.location?.country || null;
  const viewerInterests = Array.isArray(viewer.interests) ? viewer.interests : [];

  if (viewerAge !== null) {
    const minAge = audience.ageRange?.min ?? 18;
    const maxAge = audience.ageRange?.max ?? 65;
    if (viewerAge < minAge || viewerAge > maxAge) return false;
  }

  const countries = Array.isArray(audience.countries) ? audience.countries : [];
  if (countries.length > 0 && viewerCountry) {
    if (!countries.includes(viewerCountry)) return false;
  }

  const interests = Array.isArray(audience.interests) ? audience.interests : [];
  if (interests.length > 0 && viewerInterests.length > 0) {
    const hasOverlap = viewerInterests.some((i) => interests.includes(i));
    if (!hasOverlap) return false;
  }

  return true;
};

const enrichPostsWithBoosts = async (
  posts,
  now = new Date(),
  viewerId = null,
  { audienceCheck = true } = {},
) => {
  if (!Array.isArray(posts) || posts.length === 0) return posts || [];

  const postIds = posts
    .map((post) => post?._id)
    .filter((postId) => mongoose.Types.ObjectId.isValid(postId));

  if (postIds.length === 0) {
    return posts.map((post) => ({
      ...post,
      boostId: null,
      isBoosted: false,
      boostObjective: null,
      boost: null,
    }));
  }

  let viewer = null;
  if (audienceCheck && viewerId && mongoose.Types.ObjectId.isValid(viewerId)) {
    viewer = await User.findById(viewerId)
      .select("dateOfBirth location.country interests")
      .lean();
  }

  const activeBoosts = await Boost.find(activeBoostFilter(postIds, now))
    .select(`${ACTIVE_BOOST_FIELDS} audience audienceMode`)
    .sort({ startDate: -1, createdAt: -1 });

  const boostByPostId = new Map();
  for (const boost of activeBoosts) {
    const key = toIdString(boost.postId);
    if (!boostByPostId.has(key)) {
      boostByPostId.set(key, serializeBoost(boost));
    }
  }

  return posts.map((post) => {
    const boost = boostByPostId.get(toIdString(post?._id)) || null;

    // audienceCheck === true (fan feed): only mark boosted if the viewer matches
    // the boost's audience. audienceCheck === false (creator's own posts): mark
    // boosted whenever an active boost exists, regardless of audience targeting.
    const isBoosted = audienceCheck
      ? Boolean(boost && viewer && checkAudienceMatch(boost, viewer))
      : Boolean(boost);

    return {
      ...post,
      boostId: isBoosted ? boost._id : null,
      isBoosted,
      boostObjective: isBoosted ? boost.objective : null,
      boost: isBoosted ? boost : null,
    };
  });
};

const syncPostBoostMarker = async (postId, { expectedBoostId = null } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(postId)) return null;

  const activeBoost = await getActiveBoostForPost(postId);
  const filter = { _id: postId };
  if (expectedBoostId) filter.boostId = expectedBoostId;

  const marker = activeBoost
    ? {
        boostId: activeBoost._id,
        isBoosted: true,
      }
    : {
        boostId: null,
        isBoosted: false,
      };

  await Post.updateOne(filter, { $set: marker });
  return activeBoost;
};

// Returns every active boost's post, shaped as a feed item (itemType "boost"),
// for the given viewer. Boosts the viewer's audience doesn't match are dropped.
const getActiveBoostItemsForUser = async (viewerId, now = new Date()) => {
  if (!viewerId || !mongoose.Types.ObjectId.isValid(viewerId)) return [];

  const viewer = await User.findById(viewerId)
    .select("dateOfBirth location.country interests")
    .lean();
  if (!viewer) return [];

  const activeBoosts = await Boost.find({
    status: ACTIVE_STATUS,
    endDate: { $gt: now },
  })
    .select(`${ACTIVE_BOOST_FIELDS} audience audienceMode`)
    .sort({ startDate: -1 })
    .lean();

  const matched = activeBoosts.filter((boost) =>
    checkAudienceMatch(boost, viewer),
  );
  if (matched.length === 0) return [];

  const boostPosts = await Post.find({
    _id: { $in: matched.map((b) => b.postId) },
    status: "published",
    isExclusive: false,
  })
    .populate("authorId", AUTHOR_FIELDS)
    .lean();

  const boostByPostId = new Map();
  for (const boost of matched) {
    if (!boostByPostId.has(toIdString(boost.postId))) {
      boostByPostId.set(toIdString(boost.postId), serializeBoost(boost));
    }
  }

  // Viewer-specific state, matching what organic feed posts carry:
  // which of these posts the viewer already liked, and which authors
  // they already follow (so hearts and follow buttons render correctly).
  const boostPostIds = boostPosts.map((p) => p._id);
  const likedPostIds = await getLikedTargetIds(viewerId, "post", boostPostIds);

  const authorIds = [
    ...new Set(
      boostPosts
        .map((p) => p.authorId?._id?.toString() || p.authorId?.toString())
        .filter(Boolean),
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  let followingAuthorIds = new Set();
  if (authorIds.length > 0) {
    const followDocs = await Follow.find({
      followerId: viewerId,
      followingId: { $in: authorIds },
    })
      .select("followingId")
      .lean();
    followingAuthorIds = new Set(
      followDocs.map((d) => d.followingId.toString()),
    );
  }

  return boostPosts.map((post) => {
    const boost = boostByPostId.get(toIdString(post._id)) || null;
    const author = post.authorId || null;
    return {
      ...post,
      postId: post._id,
      isLiked: likedPostIds.has(toIdString(post._id)),
      author: author
        ? {
            ...author,
            isFollowing: followingAuthorIds.has(toIdString(author._id)),
          }
        : null,
      authorId: author?._id || author,
      boostId: boost?._id || null,
      isBoosted: Boolean(boost),
      boostObjective: boost?.objective || null,
      boost,
      itemType: "boost",
    };
  });
};


//     userId, so different viewers see a different boost leading each page
const interleaveBoostItemsIntoFeed = async (
  feed,
  boostItems,
  globalPostStart,
  viewerId = null,
  interval = BOOST_REPEAT_INTERVAL,
) => {
  if (boostItems.length === 0) return feed;

  // --- rotation: deterministic per-viewer starting offset ---
  let rotationOffset = 0;
  if (viewerId) {
    let hash = 0;
    const str = String(viewerId);
    for (let k = 0; k < str.length; k++) {
      hash = ((hash << 5) - hash + str.charCodeAt(k)) | 0;
    }
    rotationOffset = Math.abs(hash) % boostItems.length;
  }

  // Apply rotation: rotate the array left by rotationOffset positions.
  const rotated =
    rotationOffset > 0
      ? [
          ...boostItems.slice(rotationOffset),
          ...boostItems.slice(0, rotationOffset),
        ]
      : boostItems;

  // --- frequency cap: unseen boosts first, seen as fallback ---
  let ordered = rotated;
  if (viewerId) {
    const postIds = rotated
      .map((b) => b.postId)
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id));

    if (postIds.length > 0) {
      const seenDocs = await PostImpression.find({
        postId: { $in: postIds },
        userId: viewerId,
      })
        .select("postId")
        .lean();

      const seenPostIds = new Set(seenDocs.map((d) => d.postId.toString()));
      const unseen = rotated.filter(
        (b) => !seenPostIds.has(String(b.postId)),
      );
      const seen = rotated.filter((b) => seenPostIds.has(String(b.postId)));
      ordered = [...unseen, ...seen];
    }
  }

  const result = [];
  let nextBoost = 0;

  for (let i = 0; i < feed.length; i++) {
    const globalIdx = globalPostStart + i;

    // This organic post sits on a boost slot — put the next boost in front.
    if (globalIdx > 0 && globalIdx % interval === 0) {
      result.push(ordered[nextBoost % ordered.length]);
      nextBoost += 1;
    }

    result.push(feed[i]);
  }

  return result;
};

module.exports = {
  ACTIVE_BOOST_FIELDS,
  BOOST_REPEAT_INTERVAL,
  checkAudienceMatch,
  enrichPostsWithBoosts,
  expireDueBoosts,
  getActiveBoostForPost,
  getActiveBoostItemsForUser,
  interleaveBoostItemsIntoFeed,
  serializeBoost,
  syncPostBoostMarker,
};