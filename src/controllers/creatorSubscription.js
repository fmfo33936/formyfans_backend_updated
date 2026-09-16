const UserModel = require("../models/auth");
const FansSubscriptionModel = require("../models/fanSubscription");
const CreatorSubscriptionModel = require("../models/creatorSubscription");
const { createCreatorSubscriptionSchema } = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");
const {
  getStripe,
  getSubscriptionPeriod,
  stripeTimestampToDate,
  centsToDollars,
} = require("../utils/stripe");

const setCreatorSubscriptionPrice = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    createCreatorSubscriptionSchema,
  );
  if (error) return res.status(400).json({ status: "error", message: error });

  try {
    const creatorId = req.user._id;
    const { price } = validatedData;

    const priceInCents = Math.round(price * 100);

    let creatorSubscription = await CreatorSubscriptionModel.findOne({
      userId: creatorId,
    });

    if (!creatorSubscription || !creatorSubscription.stripeProductId) {
      const user = await UserModel.findById(creatorId);

      const stripeProduct = await getStripe().products.create({
        name: `${creatorId.toString()} - Creator Subscription`,
        images: user.coverImage ? [user.coverImage] : undefined,
        description: `Monthly subscription price set by ${creatorId.toString()} to allow fans to see exclusive content`,
        metadata: { creatorId: creatorId.toString() },
      });

      const stripePrice = await getStripe().prices.create({
        unit_amount: priceInCents,
        currency: "usd",
        recurring: { interval: "month" },
        product: stripeProduct.id,
        metadata: { creatorId: creatorId.toString() },
      });

      creatorSubscription = await CreatorSubscriptionModel.findOneAndUpdate(
        { userId: creatorId },
        {
          userId: creatorId,
          subscriptionPrice: price,
          stripePriceId: stripePrice.id,
          stripeProductId: stripeProduct.id,
          isSubscriptionActive: true,
        },
        { upsert: true, new: true },
      );

      return res.status(201).json({
        message: "Subscription price set successfully",
        data: creatorSubscription,
        status: "success",
      });
    }

    await getStripe().prices.update(creatorSubscription.stripePriceId, {
      active: false,
    });

    const newStripePrice = await getStripe().prices.create({
      unit_amount: priceInCents,
      currency: "usd",
      recurring: { interval: "month" },
      product: creatorSubscription.stripeProductId,
      metadata: { creatorId: creatorId.toString() },
    });

    creatorSubscription.subscriptionPrice = price;
    creatorSubscription.stripePriceId = newStripePrice.id;
    await creatorSubscription.save();

    res.json({
      status: "success",
      message: "Subscription price updated successfully",
      data: creatorSubscription,
    });
  } catch (error) {
    console.error("setSubscriptionPrice error:", error);
    res.status(500).json({ status: "fail", message: error.message });
  }
};

const getCreatorSubscriptionPrice = async (req, res) => {
  try {
    const creatorId = req.user._id;

    const creatorPrice = await CreatorSubscriptionModel.findOne({
      userId: creatorId,
    }).populate("userId", "username");

    res.json({
      status: "success",
      data: creatorPrice,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getFanSubsribedOrNot = async (req, res) => {
  try {
    const { username } = req.params;
    const fanId = req.user._id;

    const creator = await UserModel.findOne({ username }).select("_id");

    const creatorPrice = await CreatorSubscriptionModel.findOne({
      userId: creator?._id,
    });

    // Check - fan already subscribed
    const existingSub = await FansSubscriptionModel.findOne({
      fanId,
      creatorId: creator?._id,
      status: { $in: ["active", "past_due"] },
    });

    const finalData = {
      creatorPrice,
      subscriptionPrice: creatorPrice?.subscriptionPrice ?? null,
      isSubscriptionActive: creatorPrice?.isSubscriptionActive ?? false,
      isSubscribed: !!existingSub,
      subscription: existingSub ?? null,
    };

    res.json({
      status: "success",
      data: finalData,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  setCreatorSubscriptionPrice,
  getCreatorSubscriptionPrice,
  getFanSubsribedOrNot,
};
