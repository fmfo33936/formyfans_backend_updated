const FanSubscriptionModel = require("../models/fanSubscription");
const CreatorSubscriptionModel = require("../models/creatorSubscription");
const UserModel = require("../models/auth");
const {
  getStripe,
  getSubscriptionPeriod,
  stripeTimestampToDate,
  centsToDollars,
} = require("../utils/stripe");

// Helper
const getOrCreateStripeCustomer = async (user) => {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await getStripe().customers.create({
    email: user.email,
    name: user.username,
    metadata: { userId: user._id.toString() },
  });

  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
};

// POST /api/fan/subscribe/initiate/:creatorId
// Step 1: Create SetupIntent  -  For card collect
const initiateCreatorSubscription = async (req, res) => {
  try {
    const fanId = req.user._id;
    const { username } = req.params;

    const user = await UserModel.findOne({ username }).select("_id");
    const creatorId = user?._id;

    const fan = await UserModel.findById(fanId);
    const creatorProfile = await CreatorSubscriptionModel.findOne({
      userId: creatorId,
      isSubscriptionActive: true,
    });

    if (!creatorProfile || !creatorProfile.stripePriceId) {
      return res.status(400).json({
        message: "This creator has not set up a subscription plan yet",
      });
    }

    // Already active subscription check
    const existing = await FanSubscriptionModel.findOne({
      fanId,
      creatorId,
      status: { $in: ["active", "past_due"] },
    });

    if (existing) {
      return res.status(400).json({
        message: "You are already subscribed to this creator",
      });
    }

    const customerId = await getOrCreateStripeCustomer(fan);

    const setupIntent = await getStripe().setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: {
        fanId: fanId.toString(),
        creatorId: creatorId.toString(),
        type: "creator_subscription",
      },
    });

    res.status(200).json({
      status: "success",
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      price: creatorProfile.subscriptionPrice,
    });
  } catch (error) {
    console.error("initiateCreatorSubscription error:", error);
    res.status(500).json({ message: error.message });
  }
};

// POST /api/fan/subscribe/confirm/:creatorId
// Step 2: Create Subscription after confirmations
const confirmCreatorSubscription = async (req, res) => {
  try {
    const fanId = req.user._id;
    const { username } = req.params;
    const { setupIntentId } = req.body;

    const user = await UserModel.findOne({ username }).select("_id");
    const creatorId = user?._id;

    const fan = await UserModel.findById(fanId);

    const creatorProfile = await CreatorSubscriptionModel.findOne({
      userId: creatorId,
      isSubscriptionActive: true,
    });

    if (!creatorProfile || !creatorProfile.stripePriceId) {
      return res.status(400).json({
        message: "This creator has not set up a subscription plan yet",
      });
    }

    const setupIntent = await getStripe().setupIntents.retrieve(setupIntentId);

    if (setupIntent.status !== "succeeded") {
      return res.status(400).json({
        message: `Card setup not completed. Status: ${setupIntent.status}`,
      });
    }

    const paymentMethodId = setupIntent.payment_method;

    // Set default payment method
    await getStripe().customers.update(setupIntent.customer, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Race condition check
    const existing = await FanSubscriptionModel.findOne({
      fanId,
      creatorId,
      status: { $in: ["active", "past_due"] },
    });

    if (existing) {
      return res.status(400).json({
        message: "You are already subscribed to this creator",
      });
    }

    // Create Subscription
    const stripeSubscription = await getStripe().subscriptions.create({
      customer: setupIntent.customer,
      items: [{ price: creatorProfile.stripePriceId }],
      default_payment_method: paymentMethodId,
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      expand: ["latest_invoice"],
      metadata: {
        fanId: fanId.toString(),
        creatorId: creatorId.toString(),
        type: "creator_subscription",
      },
    });

    const { currentPeriodStart, currentPeriodEnd } =
      getSubscriptionPeriod(stripeSubscription);

    // Save in DB
    const fanSub = await FanSubscriptionModel.create({
      fanId,
      creatorId,
      stripeSubscriptionId: stripeSubscription.id,
      stripeCustomerId: setupIntent.customer,
      stripePriceId: creatorProfile.stripePriceId,
      price: creatorProfile.subscriptionPrice,
      status: stripeSubscription.status,
      currentPeriodStart,
      currentPeriodEnd,
    });

    res.status(201).json({
      message: "Subscribed successfully",
      subscription: fanSub,
      // status: stripeSubscription.status,
      status: "success",
    });
  } catch (error) {
    console.error("confirmCreatorSubscription error:", error);
    res.status(500).json({ message: error.message });
  }
};

// POST /api/fan/subscribe/cancel/:creatorId
const cancelCreatorSubscription = async (req, res) => {
  try {
    const fanId = req.user._id;
    const { username } = req.params;

    const user = await UserModel.findOne({ username }).select("_id");
    const creatorId = user?._id;

    const fanSub = await FanSubscriptionModel.findOne({
      fanId,
      creatorId,
      status: { $in: ["active", "past_due"] },
    });

    if (!fanSub) {
      return res.status(404).json({ message: "No active subscription found" });
    }

    // Cancel at Period end
    const updatedSub = await getStripe().subscriptions.update(
      fanSub.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );

    fanSub.cancelAtPeriodEnd = true;
    fanSub.canceledAt = new Date();
    fanSub.status = updatedSub.status;
    await fanSub.save();

    res.json({
      message: "Subscription will cancel at end of current billing period",
      currentPeriodEnd: fanSub.currentPeriodEnd,
      status: "success",
    });
  } catch (error) {
    console.error("cancelCreatorSubscription error:", error);
    res.status(500).json({ message: error.message });
  }
};

// POST /api/fan/subscribe/resume/:creatorId
const resumeCreatorSubscription = async (req, res) => {
  try {
    const fanId = req.user._id;
    const { username } = req.params;

    const user = await UserModel.findOne({ username }).select("_id");
    const creatorId = user?._id;

    const fanSub = await FanSubscriptionModel.findOne({
      fanId,
      creatorId,
      cancelAtPeriodEnd: true,
      status: { $in: ["active", "past_due"] },
    });

    if (!fanSub) {
      return res.status(404).json({
        message: "No pending cancellation found",
      });
    }

    const updatedSub = await getStripe().subscriptions.update(
      fanSub.stripeSubscriptionId,
      { cancel_at_period_end: false },
    );

    fanSub.cancelAtPeriodEnd = false;
    fanSub.canceledAt = null;
    fanSub.status = updatedSub.status;
    await fanSub.save();

    res.json({
      message: "Subscription resumed successfully",
      subscription: fanSub,
      status: "success",
    });
  } catch (error) {
    console.error("resumeCreatorSubscription error:", error);
    res.status(500).json({ message: error.message });
  }
};

// GET /api/fan/subscribe/status/:creatorId
const getCreatorSubscriptionStatus = async (req, res) => {
  try {
    const fanId = req.user._id;
    const { username } = req.params;

    const user = await UserModel.findOne({ username }).select("_id");
    const creatorId = user?._id;

    const fanSub = await FanSubscriptionModel.findOne({
      fanId,
      creatorId,
    }).sort({ createdAt: -1 });

    res.json({
      isSubscribed: fanSub?.status === "active",
      subscription: fanSub ?? null,
      status: "success",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  initiateCreatorSubscription,
  confirmCreatorSubscription,
  cancelCreatorSubscription,
  resumeCreatorSubscription,
  getCreatorSubscriptionStatus,
};
