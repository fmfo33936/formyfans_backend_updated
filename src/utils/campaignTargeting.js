const mongoose = require("mongoose");
const Campaign = require("../models/campaign");
const User = require("../models/auth");
const Follow = require("../models/follow");
const {
  CAMPAIGN_DEFAULT_RADIUS_KM,
  CAMPAIGN_FEED_INTERVAL,
  CAMPAIGN_MAX_RADIUS_KM,
} = require("../constants");
const { getLikedTargetIds } = require("./engagementHelper");

const getUserAgeYears = (dateOfBirth) => {
  if (!dateOfBirth) return null;

  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }

  return age;
};

const hasTargetingProfile = (user) => {
  if (!user) return false;

  const coords = user.location?.coordinates;
  return Boolean(
    user.gender &&
    user.dateOfBirth &&
    Array.isArray(user.interests) &&
    user.interests.length > 0 &&
    Array.isArray(coords) &&
    coords.length === 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number",
  );
};

const loadTargetingUser = async (userOrId) => {
  if (!userOrId) return null;

  if (hasTargetingProfile(userOrId)) {
    return userOrId;
  }

  const userId = userOrId._id || userOrId;
  return User.findById(userId)
    .select("gender dateOfBirth interests location")
    .lean();
};

const formatCampaignFeedItem = (
  campaign,
  { isLiked = false, isFollowingCreator = false } = {},
) => ({
  itemType: "campaign",
  _id: campaign._id,
  brand: campaign.brand,
  name: campaign.name,
  description: campaign.description,
  advertisement: campaign.advertisement,
  objective: campaign.objectiveDetails || null,
  category: campaign.categoryDetails || null,
  creator: campaign.creatorDetails
    ? {
        ...campaign.creatorDetails,
        isFollowing: isFollowingCreator,
      }
    : null,
  endDateTime: campaign.endDateTime,
  startDateTime: campaign.startDateTime || null,
  launchType: campaign.launchType,
  likesCount: campaign.likesCount ?? 0,
  commentsCount: campaign.commentsCount ?? 0,
  sharesCount: campaign.sharesCount ?? 0,
  isLiked,
});

const getEligibleCampaignsForUser = async (
  userOrId,
  { limit = 20, skip = 0, viewerId = null } = {},
) => {
  const user = await loadTargetingUser(userOrId);

  if (!hasTargetingProfile(user)) {
    return [];
  }

  const userAge = getUserAgeYears(user.dateOfBirth);
  if (userAge === null) {
    return [];
  }

  const now = new Date();
  const [longitude, latitude] = user.location.coordinates;
  const userId = new mongoose.Types.ObjectId(user._id);
  const maxDistanceMeters = CAMPAIGN_MAX_RADIUS_KM * 1000;
  const safeSkip = Math.max(0, Number(skip) || 0);
  const safeLimit = Math.max(0, Number(limit) || 0);

  if (safeLimit === 0) {
    return [];
  }

  const campaigns = await Campaign.aggregate([
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        distanceField: "distanceMeters",
        spherical: true,
        maxDistance: maxDistanceMeters,
        query: {
          status: "live",
          paymentStatus: "paid",
          endDateTime: { $gt: now },
          creator: { $ne: userId },
          gender: { $in: [user.gender] },
          interests: { $in: user.interests },
          "ageRange.min": { $lte: userAge },
          "ageRange.max": { $gte: userAge },
          $or: [
            {
              launchType: "immediate",
              createdAt: { $lte: now },
            },
            {
              launchType: "scheduled",
              startDateTime: { $lte: now },
            },
          ],
        },
      },
    },
    {
      $match: {
        $expr: {
          $lte: [
            "$distanceMeters",
            {
              $multiply: [
                { $ifNull: ["$radiusInKm", CAMPAIGN_DEFAULT_RADIUS_KM] },
                1000,
              ],
            },
          ],
        },
      },
    },
    {
      $lookup: {
        from: "campaign_objective",
        localField: "objective",
        foreignField: "_id",
        as: "objectiveDetails",
        pipeline: [{ $project: { icon: 1, name: 1 } }],
      },
    },
    {
      $lookup: {
        from: "campaign_category",
        localField: "category",
        foreignField: "_id",
        as: "categoryDetails",
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "creator",
        foreignField: "_id",
        as: "creatorDetails",
        pipeline: [
          {
            $project: {
              firstName: 1,
              lastName: 1,
              username: 1,
              image: 1,
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: "$objectiveDetails",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$categoryDetails",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$creatorDetails",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        brand: 1,
        name: 1,
        description: 1,
        advertisement: 1,
        objectiveDetails: 1,
        categoryDetails: 1,
        creatorDetails: 1,
        endDateTime: 1,
        startDateTime: 1,
        launchType: 1,
        likesCount: 1,
        commentsCount: 1,
        sharesCount: 1,
      },
    },
    ...(safeSkip > 0 ? [{ $skip: safeSkip }] : []),
    { $limit: safeLimit },
  ]);

  const likedIds = await getLikedTargetIds(
    viewerId || user._id,
    "campaign",
    campaigns.map((c) => c._id),
  );

  const viewerObjectId = new mongoose.Types.ObjectId(viewerId || user._id);
  const creatorIds = [
    ...new Set(
      campaigns
        .map((c) => c.creatorDetails?._id?.toString())
        .filter(Boolean),
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const followingDocs =
    creatorIds.length > 0
      ? await Follow.find({
          followerId: viewerObjectId,
          followingId: { $in: creatorIds },
        })
          .select("followingId")
          .lean()
      : [];

  const followingCreatorIds = new Set(
    followingDocs.map((doc) => doc.followingId.toString()),
  );

  return campaigns.map((campaign) =>
    formatCampaignFeedItem(campaign, {
      isLiked: likedIds.has(campaign._id.toString()),
      isFollowingCreator: followingCreatorIds.has(
        campaign.creatorDetails?._id?.toString(),
      ),
    }),
  );
};

const interleaveCampaignsIntoFeed = (
  posts,
  campaigns,
  interval = CAMPAIGN_FEED_INTERVAL,
  { postsAlreadyCounted = 0 } = {},
) => {
  const safeInterval = Math.max(1, Number(interval) || CAMPAIGN_FEED_INTERVAL);
  const postsWithType = (posts || []).map((post) => ({
    ...post,
    itemType: "post",
  }));

  if (!campaigns?.length || !postsWithType.length) {
    return postsWithType;
  }

  const feed = [];
  let campaignIndex = 0;
  // Continue the "every N posts" counter across pages so ads stay every 5
  // globally (e.g. page1 ends mid-cycle → page2 injects sooner).
  let postsSinceLastCampaign = Math.max(0, Number(postsAlreadyCounted) || 0) % safeInterval;

  for (const post of postsWithType) {
    feed.push(post);
    postsSinceLastCampaign += 1;

    if (
      postsSinceLastCampaign >= safeInterval &&
      campaignIndex < campaigns.length
    ) {
      feed.push(campaigns[campaignIndex]);
      campaignIndex += 1;
      postsSinceLastCampaign = 0;
    }
  }

  return feed;
};

/** How many campaigns belong between global post indices [start, start+count). */
const countCampaignSlotsInRange = (start, count, interval) => {
  const safeInterval = Math.max(1, Number(interval) || CAMPAIGN_FEED_INTERVAL);
  if (count <= 0) return 0;

  const end = start + count; // exclusive, 0-based post stream
  // Inject after posts at 1-based positions: interval, 2*interval, ...
  const firstSlot = Math.ceil((start + 1) / safeInterval) * safeInterval;
  if (firstSlot > end) return 0;

  return Math.floor((end - firstSlot) / safeInterval) + 1;
};

module.exports = {
  getEligibleCampaignsForUser,
  formatCampaignFeedItem,
  interleaveCampaignsIntoFeed,
  countCampaignSlotsInRange,
  hasTargetingProfile,
  getUserAgeYears,
  CAMPAIGN_FEED_INTERVAL,
};
