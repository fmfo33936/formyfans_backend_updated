const mongoose = require("mongoose");
const Post = require("../models/post");
const User = require("../models/auth");
const Boost = require("../models/boost");
const { getStripe } = require("../utils/stripe");
const { calculateReach } = require("../utils/reach");
const { getUserAgeYears } = require("../utils/campaignTargeting");
const { schemaValidator } = require("../utils/validator");
const {
  estimateBoostReachSchema,
  createBoostSchema,
} = require("../utils/validations");
const {
  serializeBoost,
  syncPostBoostMarker,
} = require("../utils/boostLifecycle");
const BoostAnalytics = require("../models/boostAnalytics");

class BoostError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
const estimateReach = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(
      req.body,
      estimateBoostReachSchema,
    );
    if (error) {
      return res
        .status(400)
        .json({ success: false, data: null, message: error });
    }

    const { budget, duration } = validatedData;
    const estimatedReach = await calculateReach(budget);
    return res.status(200).json({
      success: true,
      data: estimatedReach,
      message: "Reach estimated",
    });
  } catch (error) {
    return next(error);
  }
};

const createBoost = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(
      req.body,
      createBoostSchema,
    );
    if (error) {
      return res
        .status(400)
        .json({ success: false, data: null, message: error });
    }

    const advertiserId = req.user._id;
    const {
      postId,
      objective,
      websiteUrl,
      audienceMode,
      audience,
      duration,
      budget,
    } = validatedData;

    const post = await Post.findById(postId).populate({
      path: "authorId",
      select:
        "firstName lastName email username location interests dateOfBirth",
    });
    if (!post) {
      return next(new BoostError(404, "Post not found"));
    }
    const creator = post.authorId;
    if (!creator) {
      return next(new BoostError(404, "Post creator not found"));
    }

    if (post.status !== "published" || post.isExclusive || post.visibility !== "public") {
      return next(
        new BoostError(
          400,
          "Only published, public, non-exclusive posts can be boosted",
        ),
      );
    }

    const existingBoost = await Boost.findOne({
      postId: post._id,
      status: { $in: ["pending", "active"] },
    }).select("_id status");
    if (existingBoost) {
      return next(
        new BoostError(
          409,
          `This post already has a ${existingBoost.status} boost`,
        ),
      );
    }

    let finalAudience;
    if (audienceMode === "automatic") {
      const age = getUserAgeYears(creator.dateOfBirth) ?? 18;
      finalAudience = {
        countries: creator.location?.country
          ? [creator.location.country]
          : [],
        interests: creator.interests || [],
        ageRange: { min: age, max: age + 10 },
      };
    } else {
      finalAudience = audience;
    }

    const estimatedReach = await calculateReach(budget);

    const stripe = getStripe();
    const advertiser = await User.findById(advertiserId).select(
      "+stripeCustomerId",
    );
    let stripeCustomerId = advertiser?.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: advertiser?.email,
        metadata: { userId: advertiserId.toString() },
      });
      stripeCustomerId = customer.id;
      await User.findByIdAndUpdate(advertiserId, {
        stripeCustomerId,
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(budget * 100), // dollars -> cents
      currency: "usd",
      customer: stripeCustomerId,
      metadata: {
        type: "post_boost",
        postId: post._id.toString(),
        advertiserId: advertiserId.toString(),
      },
    });

    const perDayBudget = budget / duration;

    const boost = await Boost.create({
      postId: post._id,
      creatorId: creator._id,
      advertiserId,
      objective,
      websiteUrl,
      audienceMode,
      audience: finalAudience,
      duration,
      budget,
      perDayBudget,
      estimatedReach,
      status: "pending",
      stripePaymentIntentId: paymentIntent.id,
      stripeCustomerId,
    });

    return res.status(201).json({
      success: true,
      data: {
        boost: serializeBoost(boost),
        clientSecret: paymentIntent.client_secret,
      },
      message: "Boost created, awaiting payment",
    });
  } catch (error) {
    return next(error);
  }
};


const finalizeBoost = async (req, res, next) => {
  try {
    const { boostId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(boostId)) {
      return next(new BoostError(400, "Invalid boost ID"));
    }

    const boost = await Boost.findOne({
      _id: boostId,
      advertiserId: req.user._id,
    });
    if (!boost) return next(new BoostError(404, "Boost not found"));
    if (!boost.stripePaymentIntentId) {
      return next(new BoostError(409, "Boost payment is not initialized"));
    }

    const paymentIntent = await getStripe().paymentIntents.retrieve(
      boost.stripePaymentIntentId,
    );
    if (
      paymentIntent.status !== "succeeded" ||
      paymentIntent.currency !== "usd" ||
      paymentIntent.amount !== Math.round(boost.budget * 100)
    ) {
      return next(new BoostError(409, "Boost payment is not completed"));
    }

    const now = new Date();
    const startDate = boost.startDate || now;
    const endDate = boost.endDate || new Date(startDate);
    if (!boost.endDate) endDate.setDate(endDate.getDate() + (boost.duration || 3));

    const activated = await Boost.findOneAndUpdate(
      { _id: boost._id, status: "pending" },
      { $set: { status: "active", startDate, endDate } },
      { new: true },
    );

    if (activated || boost.status === "active") {
      await syncPostBoostMarker(boost.postId);
    }

    // Create analytics record for this boost
    if (activated) {
      await BoostAnalytics.create({
        boostId: activated._id,
        postId: activated.postId,
        creatorId: activated.creatorId,
        objective: activated.objective,
      });
    }

    const current = activated || boost;
    return res.status(200).json({
      success: true,
      data: { boost: serializeBoost(current) },
      message: "Boost finalized successfully",
    });
  } catch (error) {
    return next(error);
  }
};

const handleBoostWebhook = async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return res.status(500).json({
      success: false,
      data: null,
      message: "STRIPE_WEBHOOK_SECRET is not configured",
    });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res
      .status(400)
      .json({ success: false, data: null, message: "Missing stripe-signature header" });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret,
    );
  } catch (error) {
    return res
      .status(400)
      .json({ success: false, data: null, message: `Webhook Error: ${error.message}` });
  }

  // Boost activation and failure handling belong to the authenticated
  // frontend finalize flow. This webhook only acknowledges Stripe events;
  // it deliberately never mutates Boost or Post state.
  return res.status(200).json({ received: true });
};

module.exports = {
  estimateReach,
  createBoost,
  handleBoostWebhook,
  finalizeBoost,
};
