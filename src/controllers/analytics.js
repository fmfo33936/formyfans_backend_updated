const mongoose = require("mongoose");
const Post = require("../models/post");
const Boost = require("../models/boost");
const PostImpression = require("../models/postImpression");
const PostAnalytics = require("../models/postAnalytics");
const BoostAnalytics = require("../models/boostAnalytics");

const toDateOnly = (d = new Date()) => {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
};

const calcBudgetSpent = (boost) => {
  if (!boost) return 0;
  const now = new Date();
  const start = new Date(boost.startDate);
  const end = new Date(boost.endDate);

  // Boost hasn't started yet
  if (now < start) return 0;

  // Boost has ended — full budget spent
  if (now >= end) return boost.budget;

  // Active — days elapsed from start to now
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysElapsed = Math.floor((now - start) / msPerDay) + 1; // inclusive of start day
  const spent = boost.perDayBudget * daysElapsed;
  return Math.min(spent, boost.budget);
};

const trackImpressions = async (req, res) => {
  try {
    const { postIds } = req.body;
    if (!Array.isArray(postIds) || postIds.length === 0) {
      return res.status(400).json({ success: false, message: "postIds array required" });
    }

    const dateOnly = toDateOnly();
    const viewerId = req.user?._id || null;
    const validIds = postIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (validIds.length === 0) {
      return res.status(200).json({ success: true });
    }

    // Impressions: direct counter increments for every viewed post. No per-view
    // log document is written, so this stays cheap even at high volume.
    await Post.bulkWrite(
      validIds.map((postId) => ({
        updateOne: { filter: { _id: postId }, update: { $inc: { impressionsCount: 1 } } },
      })),
      { ordered: false },
    ).catch(() => {});

    await PostAnalytics.bulkWrite(
      validIds.map((postId) => ({
        updateOne: {
          filter: { postId, dateOnly },
          update: { $inc: { impressions: 1 }, $setOnInsert: { postId, dateOnly } },
          upsert: true,
        },
      })),
      { ordered: false },
    ).catch(() => {});

    // Reach is only meaningful for boosted content, so it's only tracked for
    // posts that currently have an active boost.
    if (!viewerId) {
      return res.status(200).json({ success: true });
    }

    const now = new Date();
    const boostedPosts = await Post.find({
      _id: { $in: validIds },
      isBoosted: true,
      boostId: { $ne: null },
    })
      .select("boostId")
      .lean();

    const boostIds = [
      ...new Set(boostedPosts.map((bp) => bp.boostId?.toString()).filter(Boolean)),
    ];

    const activeBoosts = await Boost.find({
      _id: { $in: boostIds },
      status: "active",
      startDate: { $lte: now },
      endDate: { $gt: now },
    }).lean();

    if (activeBoosts.length === 0) {
      return res.status(200).json({ success: true });
    }

    const activeBoostByPostId = new Map();
    for (const boost of activeBoosts) {
      if (!activeBoostByPostId.has(boost.postId.toString())) {
        activeBoostByPostId.set(boost.postId.toString(), boost);
      }
    }

    // First-time viewers of each boosted post get a reach increment. The
    // PostImpression doc (unique per post + user) dedupes the viewer, so each
    // user only ever adds one doc per boosted post.
    const reachIncrementIds = [];
    for (const bp of boostedPosts) {
      if (!activeBoostByPostId.has(bp._id.toString())) continue;
      try {
        const result = await PostImpression.updateOne(
          { postId: bp._id, userId: viewerId },
          { $setOnInsert: { postId: bp._id, userId: viewerId, firstViewedAt: now } },
          { upsert: true },
        );
        if (result.upsertedCount === 1) reachIncrementIds.push(bp._id.toString());
      } catch {
        // Duplicate key race — viewer already tracked, skip
      }
    }

    if (reachIncrementIds.length > 0) {
      await Post.bulkWrite(
        reachIncrementIds.map((postId) => ({
          updateOne: { filter: { _id: postId }, update: { $inc: { reachCount: 1 } } },
        })),
        { ordered: false },
      ).catch(() => {});

      await PostAnalytics.bulkWrite(
        reachIncrementIds.map((postId) => ({
          updateOne: {
            filter: { postId, dateOnly },
            update: { $inc: { reach: 1 }, $setOnInsert: { postId, dateOnly } },
            upsert: true,
          },
        })),
        { ordered: false },
      ).catch(() => {});
    }

    // Aggregate impressions/reach per boost, then write them in one bulk.
    const boostMap = new Map(activeBoosts.map((b) => [b._id.toString(), b]));
    const reachSet = new Set(reachIncrementIds);
    const perBoost = new Map(); // boostId -> { impressions, reach }

    for (const bp of boostedPosts) {
      const boostId = bp.boostId?.toString();
      if (!boostMap.has(boostId)) continue;
      const entry = perBoost.get(boostId) || { impressions: 0, reach: 0 };
      entry.impressions += 1;
      if (reachSet.has(bp._id.toString())) entry.reach += 1;
      perBoost.set(boostId, entry);
    }

    const boostAnalyticsUpdates = [];
    for (const [boostId, { impressions, reach }] of perBoost) {
      const boost = boostMap.get(boostId);
      boostAnalyticsUpdates.push({
        updateOne: {
          filter: { boostId: new mongoose.Types.ObjectId(boostId) },
          update: {
            $inc: { totalImpressions: impressions, totalReach: reach },
            $setOnInsert: {
              postId: boost.postId,
              creatorId: boost.creatorId,
              objective: boost.objective,
            },
          },
          upsert: true,
        },
      });
    }

    if (boostAnalyticsUpdates.length > 0) {
      await BoostAnalytics.bulkWrite(boostAnalyticsUpdates, { ordered: false }).catch(() => {});
    }

    return res.status(200).json({ success: true });
  } catch {
    return res.status(200).json({ success: true });
  }
};

const trackProfileVisit = async (req, res) => {
  try {
    const { postId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid post ID" });
    }

    const post = await Post.findById(postId)
      .select("isBoosted boostId")
      .lean();

    if (post?.isBoosted && post?.boostId) {
      const now = new Date();
      const activeBoost = await Boost.findOne({
        _id: post.boostId,
        status: "active",
        objective: "profile",
        startDate: { $lte: now },
        endDate: { $gt: now },
      })
        .select("_id postId creatorId objective")
        .lean();

      if (activeBoost) {
        await BoostAnalytics.findOneAndUpdate(
          { boostId: activeBoost._id },
          {
            $inc: { profileVisits: 1 },
            $setOnInsert: {
              postId: activeBoost.postId,
              creatorId: activeBoost.creatorId,
              objective: activeBoost.objective,
            },
          },
          { upsert: true },
        );
      }
    }

    return res.status(200).json({ success: true });
  } catch {
    return res.status(200).json({ success: true });
  }
};

const trackWebsiteClick = async (req, res) => {
  try {
    const { boostId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(boostId)) {
      return res.status(400).json({ success: false, message: "Invalid boost ID" });
    }

    const boost = await Boost.findById(boostId).lean();
    await BoostAnalytics.findOneAndUpdate(
      { boostId },
      {
        $inc: { websiteClicks: 1 },
        $setOnInsert: boost
          ? { postId: boost.postId, creatorId: boost.creatorId, objective: boost.objective }
          : {},
      },
      { upsert: true },
    );

    return res.status(200).json({ success: true });
  } catch {
    return res.status(200).json({ success: true });
  }
};

const getPostAnalytics = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const { boostId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid post ID" });
    }

    const post = await Post.findById(postId).select("authorId isBoosted boostId").lean();
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }
    if (post.authorId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const lifetimeAgg = await PostAnalytics.aggregate([
      { $match: { postId: new mongoose.Types.ObjectId(postId) } },
      {
        $group: {
          _id: null,
          reach: { $sum: "$reach" },
          impressions: { $sum: "$impressions" },
          likes: { $sum: "$likes" },
          comments: { $sum: "$comments" },
          shares: { $sum: "$shares" },
        },
      },
    ]);

    const lifetime = lifetimeAgg[0] || { reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0 };

    const allBoosts = await Boost.find({ postId })
      .select("_id objective startDate endDate duration budget perDayBudget status")
      .sort({ startDate: -1 })
      .lean();

    const hasBoosts = allBoosts.length > 0;

    if (boostId) {
      const boost = allBoosts.find((b) => b._id.toString() === boostId);
      if (!boost) {
        return res.status(404).json({ success: false, message: "Boost not found for this post" });
      }

      const boostAnalyticsDoc = await BoostAnalytics.findOne({ boostId }).lean();
      const budgetSpent = calcBudgetSpent(boost);
      const remainingBudget = Math.max(0, boost.budget - budgetSpent);
      const ba = boostAnalyticsDoc || {};
      const totalLikes = ba.totalLikes || 0;
      const totalComments = ba.totalComments || 0;
      const totalShares = ba.totalShares || 0;

      return res.status(200).json({
        success: true,
        data: {
          reach: ba.totalReach || 0,
          impressions: ba.totalImpressions || 0,
          engagement: {
            likes: totalLikes,
            comments: totalComments,
            shares: totalShares,
            total: totalLikes + totalComments + totalShares,
          },
          ...(boost.objective === "profile"
            ? { profileVisits: boostAnalyticsDoc?.profileVisits || 0 }
            : {}),
          ...(boost.objective === "messages"
            ? { messagesSent: boostAnalyticsDoc?.messagesSent || 0 }
            : {}),
          ...(boost.objective === "website"
            ? { websiteClicks: boostAnalyticsDoc?.websiteClicks || 0 }
            : {}),
          budget: boost.budget,
          perDayBudget: boost.perDayBudget,
          budgetSpent: Math.round(budgetSpent * 100) / 100,
          remainingBudget: Math.round(remainingBudget * 100) / 100,
          startDate: boost.startDate,
          endDate: boost.endDate,
          status: boost.status,
          objective: boost.objective,
        },
      });
    }

    if (!hasBoosts) {
      return res.status(200).json({
        success: true,
        data: {
          reach: lifetime.reach,
          impressions: lifetime.impressions,
          engagement: {
            likes: lifetime.likes,
            comments: lifetime.comments,
            shares: lifetime.shares,
            total: lifetime.likes + lifetime.comments + lifetime.shares,
          },
        },
      });
    }

    const boostAnalyticsDocs = await BoostAnalytics.find({
      postId: new mongoose.Types.ObjectId(postId),
    }).lean();

    const summed = {
      totalReach: 0,
      totalImpressions: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      profileVisits: 0,
      messagesSent: 0,
      websiteClicks: 0,
    };

    const perBoost = [];

    for (const ba of boostAnalyticsDocs) {
      summed.totalReach += ba.totalReach || 0;
      summed.totalImpressions += ba.totalImpressions || 0;
      summed.totalLikes += ba.totalLikes || 0;
      summed.totalComments += ba.totalComments || 0;
      summed.totalShares += ba.totalShares || 0;
      summed.profileVisits += ba.profileVisits || 0;
      summed.messagesSent += ba.messagesSent || 0;
      summed.websiteClicks += ba.websiteClicks || 0;

      const boost = allBoosts.find((b) => b._id.toString() === ba.boostId.toString());
      if (boost) {
        const budgetSpent = calcBudgetSpent(boost);
        const remainingBudget = Math.max(0, (boost.budget || 0) - budgetSpent);
        perBoost.push({
          boostId: ba.boostId,
          objective: ba.objective,
          totalReach: ba.totalReach || 0,
          totalImpressions: ba.totalImpressions || 0,
          engagement: {
            likes: ba.totalLikes || 0,
            comments: ba.totalComments || 0,
            shares: ba.totalShares || 0,
            total: (ba.totalLikes || 0) + (ba.totalComments || 0) + (ba.totalShares || 0),
          },
          profileVisits: ba.profileVisits || 0,
          messagesSent: ba.messagesSent || 0,
          websiteClicks: ba.websiteClicks || 0,
          budget: boost.budget,
          budgetSpent: Math.round(budgetSpent * 100) / 100,
          remainingBudget: Math.round(remainingBudget * 100) / 100,
          startDate: boost.startDate,
          endDate: boost.endDate,
          status: boost.status,
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        totalReach: summed.totalReach,
        totalImpressions: summed.totalImpressions,
        totalEngagement: {
          likes: summed.totalLikes,
          comments: summed.totalComments,
          shares: summed.totalShares,
          total: summed.totalLikes + summed.totalComments + summed.totalShares,
        },
        totalProfileVisits: summed.profileVisits,
        totalMessagesSent: summed.messagesSent,
        totalWebsiteClicks: summed.websiteClicks,
        boosts: perBoost,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const getCreatorBoostAnalytics = async (req, res, next) => {
  try {
    const creatorId = req.user._id;
    const { period = "30d" } = req.query;

    const periodDays =
      period === "7d" ? 7 : period === "90d" ? 90 : period === "all" ? null : 30;

    // All boosts owned by this creator (creator side), regardless of who paid.
    const boostFilter = { creatorId };
    let boostQuery = Boost.find(boostFilter).sort({ createdAt: -1 });

    if (periodDays) {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - periodDays);
      // Include boosts currently active + ones that ran within the window.
      boostQuery = boostQuery.or([
        { status: "active" },
        { endDate: { $gte: sinceDate } },
      ]);
    }

    const boosts = await boostQuery.lean();

    if (boosts.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          totals: {
            reach: 0,
            impressions: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            engagement: 0,
            profileVisits: 0,
            messagesSent: 0,
            websiteClicks: 0,
            budgetSpent: 0,
            budget: 0,
            activeBoosts: 0,
          },
          boosts: [],
        },
      });
    }

    const boostIds = boosts.map((b) => b._id);

    // One analytics record per boost — lifetime totals since the boost started.
    const analyticsDocs = await BoostAnalytics.find({ boostId: { $in: boostIds } }).lean();
    const analyticsMap = new Map(
      analyticsDocs.map((a) => [a.boostId.toString(), a]),
    );

    // Post metadata so the frontend can render caption/thumbnail for each boost.
    const postIds = [...new Set(boosts.map((b) => b.postId.toString()))];
    const posts = await Post.find({ _id: { $in: postIds } })
      .select("_id caption media likesCount createdAt")
      .lean();
    const postMap = new Map(posts.map((p) => [p._id.toString(), p]));

    // Monthly impressions from PostAnalytics daily buckets for boosted posts.
    // NOTE: aggregate() does NOT auto-cast string IDs — normalize to ObjectIds.
    const impressionsMatch = {
      postId: { $in: postIds.map((id) => new mongoose.Types.ObjectId(id)) },
    };
    if (periodDays) {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - periodDays);
      impressionsMatch.dateOnly = { $gte: sinceDate };
    }
    const monthlyImpressions = await PostAnalytics.aggregate([
      { $match: impressionsMatch },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$dateOnly" } },
          impressions: { $sum: "$impressions" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Top 5 normal posts by likes (not boosted posts — organic content).
    const topPosts = await Post.find({ authorId: creatorId })
      .select("_id caption media likesCount commentsCount createdAt")
      .sort({ likesCount: -1 })
      .limit(5)
      .lean();

    const totals = {
      reach: 0,
      impressions: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement: 0,
      profileVisits: 0,
      messagesSent: 0,
      websiteClicks: 0,
      budgetSpent: 0,
      budget: 0,
      activeBoosts: 0,
    };

    const perBoost = boosts.map((boost) => {
      const ba = analyticsMap.get(boost._id.toString()) || {};
      const budgetSpent = calcBudgetSpent(boost);

      const likes = ba.totalLikes || 0;
      const comments = ba.totalComments || 0;
      const shares = ba.totalShares || 0;
      const reach = ba.totalReach || 0;
      const impressions = ba.totalImpressions || 0;

      totals.reach += reach;
      totals.impressions += impressions;
      totals.likes += likes;
      totals.comments += comments;
      totals.shares += shares;
      totals.engagement += likes + comments + shares;
      totals.profileVisits += ba.profileVisits || 0;
      totals.messagesSent += ba.messagesSent || 0;
      totals.websiteClicks += ba.websiteClicks || 0;
      totals.budgetSpent += budgetSpent;
      totals.budget += boost.budget || 0;
      if (boost.status === "active") totals.activeBoosts += 1;

      const post = postMap.get(boost.postId.toString());

      return {
        boostId: boost._id,
        postId: boost.postId,
        objective: boost.objective,
        status: boost.status,
        startDate: boost.startDate,
        endDate: boost.endDate,
        budget: boost.budget || 0,
        budgetSpent: Math.round(budgetSpent * 100) / 100,
        remainingBudget: Math.round(Math.max(0, (boost.budget || 0) - budgetSpent) * 100) / 100,
        reach,
        impressions,
        engagement: { likes, comments, shares, total: likes + comments + shares },
        profileVisits: ba.profileVisits || 0,
        messagesSent: ba.messagesSent || 0,
        websiteClicks: ba.websiteClicks || 0,
        post: post
          ? {
              _id: post._id,
              caption: post.caption,
              media: post.media,
              likesCount: post.likesCount || 0,
              createdAt: post.createdAt,
            }
          : null,
      };
    });

    // Top performing = highest engagement (sorted by likes).
    perBoost.sort((a, b) => b.engagement.likes - a.engagement.likes);

    totals.budgetSpent = Math.round(totals.budgetSpent * 100) / 100;

    return res.status(200).json({
      success: true,
      data: { totals, boosts: perBoost, topPosts, monthlyImpressions },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  trackImpressions,
  trackProfileVisit,
  trackWebsiteClick,
  getPostAnalytics,
  getCreatorBoostAnalytics,
};
