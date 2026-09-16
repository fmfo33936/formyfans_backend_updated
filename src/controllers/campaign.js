const Campaign = require("../models/campaign");
const CampaignObjective = require("../models/campaignObjective");
const CampaignCategory = require("../models/campaignCategory");
const User = require("../models/auth");
const { schemaValidator } = require("../utils/validator");
const {
  createCampaignSchema,
  updateCampaignSchema,
  campaignEstimatedReachSchema,
} = require("../utils/validations");
const { getStripe, dollarsToCents } = require("../utils/stripe");
const mongoose = require("mongoose");
const stripe = getStripe();
const { parsePagination } = require("../utils/socialHelpers");

// ---------------- CREATE + PAY (Step 8: Publish) ----------------
const createCampaign = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    createCampaignSchema,
  );
  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  const { paymentMethodId, ...campaignData } = validatedData;

  if (!paymentMethodId) {
    return res
      .status(400)
      .json({ status: "fail", message: "Payment method required" });
  }

  const user = req.user;
  const creatorId = user?._id;

  // ---- Step 1: Create the campaign first (with Pending status) so that
  //  there is no risk of the campaign not being created after a successful payment.

  let campaign;
  try {
    campaign = await Campaign.create({
      ...campaignData,
      creator: creatorId,
      paymentStatus: "pending",
    });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ status: "fail", message: "Campaign already exists" });
    }
    return res.status(500).json({ status: "fail", message: err.message });
  }

  // ---- Step 2: Payment attempt ----
  try {
    const amountInCents = dollarsToCents(campaign.dailyBudget);

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency: "usd",
        payment_method: paymentMethodId,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata: {
          campaignId: campaign._id.toString(),
          type: "create_campaign",
        },
      },
      { idempotencyKey: campaign._id.toString() }, // double-click/double-submit safe
    );

    campaign.paymentIntentId = paymentIntent.id;

    if (paymentIntent.status === "requires_action") {
      await campaign.save();
      return res.status(200).json({
        status: "requires_action",
        message: "Additional authentication required",
        clientSecret: paymentIntent.client_secret,
        campaignId: campaign._id,
      });
    }

    if (paymentIntent.status === "succeeded") {
      campaign.paymentStatus = "paid";
      await campaign.save();
      return res.status(201).json({
        status: "success",
        message: "Campaign published successfully",
        data: campaign,
      });
    }

    // Any other status (declined, canceled, etc.)
    campaign.paymentStatus = "failed";
    await campaign.save();
    return res.status(402).json({
      status: "fail",
      message: "Payment failed",
      campaignId: campaign._id,
    });
  } catch (err) {
    campaign.paymentStatus = "failed";
    await campaign.save().catch(() => {});

    if (err.type === "StripeCardError") {
      return res.status(402).json({
        status: "fail",
        message: err.message,
        campaignId: campaign._id,
      });
    }
    return res.status(500).json({
      status: "fail",
      message: "Payment processing error. Please retry.",
      campaignId: campaign._id,
    });
  }
};

// ---------------- CONFIRM (after 3D Secure) ----------------
const confirmCampaignPayment = async (req, res) => {
  const { paymentIntentId } = req.body;

  if (!paymentIntentId) {
    return res
      .status(400)
      .json({ status: "fail", message: "paymentIntentId required" });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return res
        .status(402)
        .json({ status: "fail", message: "Payment not completed" });
    }

    const campaign = await Campaign.findOneAndUpdate(
      { paymentIntentId },
      { paymentStatus: "paid" },
      { new: true },
    );

    if (!campaign) {
      return res
        .status(404)
        .json({ status: "fail", message: "Campaign not found" });
    }

    return res.status(200).json({
      status: "success",
      message: "Campaign published successfully",
      data: campaign,
    });
  } catch (err) {
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

const retryCampaignPayment = async (req, res) => {
  const { campaignId, paymentMethodId } = req.body;

  if (!campaignId || !paymentMethodId) {
    return res.status(400).json({
      status: "fail",
      message: "campaignId and paymentMethodId required",
    });
  }

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    return res
      .status(404)
      .json({ status: "fail", message: "Campaign not found" });
  }

  if (campaign.paymentStatus === "paid") {
    return res
      .status(400)
      .json({ status: "fail", message: "Campaign already paid" });
  }

  try {
    const amountInCents = dollarsToCents(campaign.dailyBudget);

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency: "usd",
        payment_method: paymentMethodId,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata: {
          campaignId: campaign._id.toString(),
          type: "create_campaign",
        },
      },
      { idempotencyKey: `${campaign._id}-retry-${Date.now()}` },
    );

    campaign.paymentIntentId = paymentIntent.id;

    if (paymentIntent.status === "requires_action") {
      await campaign.save();
      return res.status(200).json({
        status: "requires_action",
        clientSecret: paymentIntent.client_secret,
        campaignId: campaign._id,
      });
    }

    if (paymentIntent.status === "succeeded") {
      campaign.paymentStatus = "paid";
      await campaign.save();
      return res.status(201).json({
        status: "success",
        message: "Campaign published successfully",
        data: campaign,
      });
    }

    campaign.paymentStatus = "failed";
    await campaign.save();
    return res.status(402).json({
      status: "fail",
      message: "Payment failed",
      campaignId: campaign._id,
    });
  } catch (err) {
    campaign.paymentStatus = "failed";
    await campaign.save().catch(() => {});

    if (err.type === "StripeCardError") {
      return res.status(402).json({
        status: "fail",
        message: err.message,
        campaignId: campaign._id,
      });
    }
    return res.status(500).json({
      status: "fail",
      message: "Payment processing error. Please retry.",
      campaignId: campaign._id,
    });
  }
};

// ---------------- Standard CRUD ----------------
const getCampaigns = async (req, res) => {
  const { page, limit, skip } = parsePagination(req);
  const user = req.user;
  const creatorId = user?._id;

  const filter = {
    creator: new mongoose.Types.ObjectId(creatorId),
  };

  try {
    const results = await Campaign.aggregate([
      {
        $match: {
          ...filter,
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
          pipeline: [{ $project: { username: 1, email: 1, image: 1 } }],
        },
      },
      // {
      //   $lookup: {
      //     from: "users",
      //     localField: "creators",
      //     foreignField: "_id",
      //     as: "creatorsDetails",
      //     pipeline: [{ $project: { username: 1, email: 1, image: 1 } }],
      //   },
      // },
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
      // {
      //   $unwind: {
      //     path: "$creatorDetails",
      //     preserveNullAndEmptyArrays: true,
      //   },
      // },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.status(200).json({
      status: "success",
      message: "Campaigns fetched successfully",
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
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const getAllCampaigns = async (req, res) => {
  const { page, limit, skip } = parsePagination(req);
  const { status, paymentStatus, creatorId } = req.query;
  const filter = {};

  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (creatorId && mongoose.Types.ObjectId.isValid(creatorId)) {
    filter.creator = new mongoose.Types.ObjectId(creatorId);
  }

  try {
    const results = await Campaign.aggregate([
      { $match: filter },
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
                email: 1,
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
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.status(200).json({
      status: "success",
      message: "Campaigns fetched successfully",
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
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const getCampaignById = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res
        .status(404)
        .json({ status: "fail", message: "Campaign not found" });
    }
    return res.status(200).json({
      status: "success",
      message: "Campaign fetched successfully",
      data: campaign,
    });
  } catch (error) {
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndDelete(req.params.id);
    if (!campaign) {
      return res
        .status(404)
        .json({ status: "fail", message: "Campaign not found" });
    }
    return res
      .status(200)
      .json({ status: "success", message: "Campaign deleted successfully" });
  } catch (error) {
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const updateCampaign = async (req, res) => {
  const { id } = req.params;

  const [error, validatedData] = schemaValidator(
    req.body,
    updateCampaignSchema,
  );

  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  const user = req.user;
  const creatorId = user?._id;

  try {
    const existingCampaign = await Campaign.findById(id);

    if (!existingCampaign) {
      return res
        .status(404)
        .json({ status: "fail", message: "Campaign not found" });
    }

    if (existingCampaign.creator?.toString() !== creatorId?.toString()) {
      return res.status(403).json({
        status: "fail",
        message: "Not authorized to update this campaign",
      });
    }

    // if (existingCampaign.paymentStatus === "paid") {
    // }

    const campaign = await Campaign.findByIdAndUpdate(
      id,
      { ...validatedData },
      { new: true, runValidators: true },
    );

    return res.status(200).json({
      status: "success",
      message: "Campaign updated successfully",
      data: campaign,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ status: "fail", message: "Campaign already exists" });
    }
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

const EARTH_RADIUS_KM = 6378.1;

const getEstimatedReachRange = (exactCount) => {
  if (exactCount <= 0) {
    return { min: 0, max: 0 };
  }

  const step =
    exactCount < 200
      ? 50
      : exactCount < 2000
        ? 100
        : exactCount < 20000
          ? 500
          : 1000;
  const min = Math.floor((exactCount * 0.8) / step) * step;
  const max = Math.ceil((exactCount * 1.2) / step) * step;

  return {
    min: Math.max(min, step === 50 ? 50 : step),
    max: Math.max(max, min + (exactCount < 200 ? 50 : step)),
  };
};

const calculateCampaignEstimatedReach = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    campaignEstimatedReachSchema,
  );

  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  const { ageRange, gender, location, interests, radiusInKm } = validatedData;
  const [longitude, latitude] = location.coordinates;

  try {
    const exactCount = await User.countDocuments({
      isDeleted: { $ne: true },
      status: "active",
      gender: { $in: gender },
      interests: { $in: interests },
      dateOfBirth: { $exists: true, $ne: null },
      $expr: {
        $and: [
          {
            $gte: [
              {
                $dateDiff: {
                  startDate: "$dateOfBirth",
                  endDate: "$$NOW",
                  unit: "year",
                },
              },
              ageRange.min,
            ],
          },
          {
            $lte: [
              {
                $dateDiff: {
                  startDate: "$dateOfBirth",
                  endDate: "$$NOW",
                  unit: "year",
                },
              },
              ageRange.max,
            ],
          },
        ],
      },
      "location.coordinates.0": { $exists: true },
      "location.coordinates.1": { $exists: true },
      location: {
        $geoWithin: {
          $centerSphere: [[longitude, latitude], radiusInKm / EARTH_RADIUS_KM],
        },
      },
    });

    const estimatedReach = getEstimatedReachRange(exactCount);

    return res.status(200).json({
      status: "success",
      message: "Campaign estimated reach calculated successfully",
      data: {
        exactCount,
        estimatedReach,
        radiusInKm,
        summary: `This campaign will be shown to approximately ${estimatedReach.min}-${estimatedReach.max} users`,
      },
    });
  } catch (err) {
    return res.status(500).json({ status: "fail", message: err.message });
  }
};

module.exports = {
  createCampaign,
  confirmCampaignPayment,
  retryCampaignPayment,
  getCampaigns,
  getCampaignById,
  deleteCampaign,
  updateCampaign,
  calculateCampaignEstimatedReach,
  getAllCampaigns,
};
