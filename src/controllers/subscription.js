const UserModel = require("../models/auth");
const Subscription = require("../models/userSubscription");
const SubscriptionPlan = require("../models/subscriptionPlans");
const { schemaValidator } = require("../utils/validator");
const { buySubscriptionSchema } = require("../utils/validations");
const {
  getStripe,
  getSubscriptionPeriod,
  stripeTimestampToDate,
  centsToDollars,
} = require("../utils/stripe");
const PaymentHistory = require("../models/paymentHistory");

const buySubscription = async (req, res) => {
  const [error, validatedBody] = schemaValidator(
    req.body,
    buySubscriptionSchema,
  );
  if (error) return res.status(400).json({ status: "error", message: error });
  try {
    const userId = req.user.id;
    const { planId, paymentIntentId } = validatedBody;

    const user = await UserModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan || !plan.isActive) {
      return res.status(400).json({ status: "error", message: "Invalid plan" });
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + plan.durationDays);

    await Subscription.updateMany(
      { userId, status: "active" },
      { status: "expired" },
    );

    const payload = {
      plan: plan.name,
      paymentId: paymentIntentId,
      price: plan.price,
      userId,
      startDate,
      endDate,
      status: "active",
    };

    const subscription = await Subscription.create(payload);

    if (user.role !== "creator") {
      user.role = "creator";
      await user.save();
    }

    return res.status(201).json({
      status: "success",
      message: "Subscription purchased successfully",
      subscription,
      user: user,
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

// Helper
const getOrCreateStripeCustomer = async (user) => {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await getStripe().customers.create({
    name: user.username,
    email: user.email,
    metadata: { userId: user._id.toString() },
  });

  user.stripeCustomerId = customer.id;
  await user.save();

  return customer.id;
};

const initiateSubscriptionSetup = async (req, res) => {
  try {
    const userId = req.user._id;
    const { planId } = req.body;

    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(400).json({ message: "Invalid plan id" });
    }

    if (!plan.stripePriceId) {
      return res.status(400).json({
        message:
          "This plan is not configured for billing. Please contact support.",
      });
    }

    const existing = await Subscription.findOne({
      userId: userId,
      status: { $in: ["trialing", "active", "past_due"] },
    });

    if (existing) {
      return res.status(400).json({
        message: "You already have an active subscription.",
      });
    }

    const customerId = await getOrCreateStripeCustomer(user);

    const hasEverSubscribed = await Subscription.exists({ userId: userId });
    const isTrialEligible = !hasEverSubscribed;

    const setupIntent = await getStripe().setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: {
        userId: userId.toString(),
        planId: planId.toString(),
        isTrialEligible: String(isTrialEligible),
      },
    });

    res.status(200).json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      isTrial: isTrialEligible,
      planName: plan.name,
    });
  } catch (error) {
    console.error("initiateSubscriptionSetup error:", error);
    res.status(500).json({ message: error.message });
  }
};

const confirmSubscriptionSetup = async (req, res) => {
  try {
    const userId = req.user._id;
    const { setupIntentId, planId } = req.body;

    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(400).json({ message: "Invalid plan id" });
    }

    const setupIntent = await getStripe().setupIntents.retrieve(setupIntentId);

    if (setupIntent.status !== "succeeded") {
      return res.status(400).json({
        message: `Card setup not completed. Status: ${setupIntent.status}`,
      });
    }

    const paymentMethodId = setupIntent.payment_method;

    await getStripe().customers.update(setupIntent.customer, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const existing = await Subscription.findOne({
      userId: userId,
      status: { $in: ["trialing", "active", "past_due"] },
    });
    if (existing) {
      return res.status(400).json({
        message: "You already have an active subscription.",
      });
    }

    const hasEverSubscribed = await Subscription.exists({ userId: userId });
    const isTrialEligible = !hasEverSubscribed;

    const subscriptionParams = {
      customer: setupIntent.customer,
      items: [{ price: plan.stripePriceId }],
      default_payment_method: paymentMethodId,
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      expand: ["latest_invoice"],
      metadata: { userId: userId.toString(), plan: plan.name, planId },
      discounts: [
        {
          coupon: process.env.STRIPE_COUPON_FIRST_3_MONTHS,
        },
      ],
    };

    if (isTrialEligible) {
      subscriptionParams.trial_period_days = 30;
      subscriptionParams.trial_settings = {
        end_behavior: { missing_payment_method: "cancel" },
      };
    }

    const stripeSubscription =
      await getStripe().subscriptions.create(subscriptionParams);

    const { currentPeriodStart, currentPeriodEnd } =
      getSubscriptionPeriod(stripeSubscription);

    const subscription = await Subscription.create({
      userId,
      planId,
      stripeCustomerId: setupIntent.customer,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: plan.stripePriceId,
      plan: plan.name,
      price: plan.price,
      status: stripeSubscription.status,
      trialStart: stripeTimestampToDate(stripeSubscription.trial_start),
      trialEnd: stripeTimestampToDate(stripeSubscription.trial_end),
      currentPeriodStart,
      currentPeriodEnd,
      hasDiscountApplied: true,
    });

    user.activeSubscriptionId = subscription._id;
    user.activeSubscriptionExpiresAt = subscription.currentPeriodEnd;
    user.role = "creator";
    await user.save();

    // await PaymentHistory.create({
    //   user: userId,
    //   subscription: subscription._id,
    //   planName: plan.name,
    //   amountInCents: 0,
    //   amount: 0,
    //   status: isTrialEligible ? "trial_start" : "paid",
    //   description: isTrialEligible
    //     ? `${plan.name} plan - 30 day free trial started`
    //     : `${plan.name} plan subscribed`,
    //   paidAt: isTrialEligible ? null : new Date(),
    // });

    res.status(201).json({
      subscriptionId: stripeSubscription.id,
      status: stripeSubscription.status,
      isTrial: isTrialEligible,
      user: user,
    });
  } catch (error) {
    console.error("confirmSubscriptionSetup error:", error);
    res.status(500).json({ message: error.message });
  }
};

const createSubscription = async (req, res) => {
  try {
    const userId = req.user._id;
    const { planName = "standard", planId } = req.body;

    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(400).json({ message: "Invalid plan id" });
    }

    if (!plan.stripePriceId) {
      return res.status(400).json({
        message:
          "This plan is not configured for billing. Please contact support.",
      });
    }

    const existing = await Subscription.findOne({
      userId: userId,
      status: { $in: ["trialing", "active", "past_due"] },
    });

    if (existing) {
      return res.status(400).json({
        message: "You already have an active subscription.",
      });
    }

    const customerId = await getOrCreateStripeCustomer(user);

    const hasEverSubscribed = await Subscription.exists({ userId: userId });
    const isTrialEligible = !hasEverSubscribed;

    const subscriptionParams = {
      customer: customerId,
      items: [{ price: plan.stripePriceId }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
      metadata: { userId: userId.toString(), plan: plan.name, planId: planId },
    };

    if (isTrialEligible) {
      subscriptionParams.trial_period_days = 30;
      subscriptionParams.trial_settings = {
        end_behavior: { missing_payment_method: "cancel" },
      };
    }

    const stripeSubscription =
      await getStripe().subscriptions.create(subscriptionParams);

    const { currentPeriodStart, currentPeriodEnd } =
      getSubscriptionPeriod(stripeSubscription);

    const subscription = await Subscription.create({
      userId: userId,
      planId: planId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: plan.stripePriceId,
      plan: plan.name,
      price: plan.price,
      status: stripeSubscription.status,
      trialStart: stripeTimestampToDate(stripeSubscription.trial_start),
      trialEnd: stripeTimestampToDate(stripeSubscription.trial_end),
      currentPeriodStart,
      currentPeriodEnd,
    });

    user.activeSubscriptionId = subscription._id;
    user.activeSubscriptionExpiresAt = subscription.currentPeriodEnd;
    await user.save();

    let clientSecret = null;

    if (stripeSubscription.pending_setup_intent) {
      clientSecret = stripeSubscription.pending_setup_intent.client_secret;
    } else if (
      stripeSubscription.latest_invoice &&
      stripeSubscription.latest_invoice.payment_intent
    ) {
      clientSecret =
        stripeSubscription.latest_invoice.payment_intent.client_secret;
    }

    res.status(201).json({
      subscriptionId: stripeSubscription.id,
      clientSecret,
      status: stripeSubscription.status,
      isTrial: isTrialEligible,
    });
  } catch (error) {
    console.error("createSubscription error:", error);
    res.status(500).json({ message: error.message });
  }
};

const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      userId: userId,
      status: { $in: ["trialing", "active", "past_due"] },
    });

    if (!subscription) {
      return res.status(404).json({ message: "No active subscription found" });
    }

    const updatedSub = await getStripe().subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );

    subscription.cancelAtPeriodEnd = true;
    subscription.canceledAt = new Date();
    subscription.status = updatedSub.status;
    await subscription.save();

    const user = await UserModel.findById(userId);
    if (user) {
      user.activeSubscriptionId = subscription._id;
      user.activeSubscriptionExpiresAt = subscription.currentPeriodEnd;
      await user.save();
    }

    res.json({
      message: "Subscription will be canceled at the end of the current period",
      currentPeriodEnd: subscription.currentPeriodEnd,
      user: user,
    });
  } catch (error) {
    console.error("cancelSubscription error:", error);
    res.status(500).json({ message: error.message });
  }
};

const resumeSubscription = async (req, res) => {
  try {
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      userId: userId,
      cancelAtPeriodEnd: true,
      status: { $in: ["trialing", "active"] },
    });

    if (!subscription) {
      return res.status(404).json({ message: "No cancellation pending found" });
    }

    const updatedSub = await getStripe().subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: false },
    );

    subscription.cancelAtPeriodEnd = false;
    subscription.canceledAt = null;
    subscription.status = updatedSub.status;
    await subscription.save();

    const user = await UserModel.findById(userId);
    if (user) {
      user.activeSubscriptionId = subscription._id;
      user.activeSubscriptionExpiresAt = subscription.currentPeriodEnd;
      await user.save();
    }

    res.json({ message: "Subscription resumed", subscription, user: user });
  } catch (error) {
    console.error("resumeSubscription error:", error);
    res.status(500).json({ message: error.message });
  }
};

const getCurrentSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      userId: req.user._id,
    }).sort({ createdAt: -1 });

    res.json({
      status: "success",
      message: "Current subscription fetched successfully",
      subscription,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPaymentHistory = async (req, res) => {
  try {
    const history = await PaymentHistory.find({ user: req.user._id }).sort({
      createdAt: -1,
    });
    res.json({
      history,
      status: "success",
      message: "Payment history fetched successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createSubscriptionForInternalUsers = async (req, res) => {
  try {
    const userId = req.user._id;
    const { planId } = req.body;

    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(400).json({ message: "Invalid plan id" });
    }

    const striperCustomerId = await getOrCreateStripeCustomer(user);

    const subscription = await Subscription.create({
      userId: userId,
      planId: planId,
      stripeCustomerId: striperCustomerId,
      stripeSubscriptionId: null,
      stripePriceId: plan.stripePriceId,
      plan: plan.name,
      price: plan.price,
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(2049, 11, 31),
    });

    user.role = "creator";
    user.stripeCustomerId = striperCustomerId;
    user.activeSubscriptionId = subscription._id;
    user.activeSubscriptionExpiresAt = subscription.currentPeriodEnd;
    await user.save();

    await PaymentHistory.create({
      user: userId,
      subscription: subscription._id,
      planName: plan.name,
      amountInCents: 0,
      amount: 0,
      status: "paid",
      description: `Internal user subscription for ${plan.name} plan`,
    });

    res.status(201).json({
      message: "Subscription created successfully",
      subscription: subscription,
      user: user,
    });
  } catch (error) {
    console.error("createSubscriptionForInternalUsers error:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  buySubscription,
  createSubscription,
  cancelSubscription,
  resumeSubscription,
  getCurrentSubscription,
  getPaymentHistory,
  initiateSubscriptionSetup,
  confirmSubscriptionSetup,
  createSubscriptionForInternalUsers,
};
