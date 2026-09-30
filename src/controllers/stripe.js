const Order = require("../models/order");
const {
  getStripe,
  dollarsToCents,
  centsToDollars,
  getSubscriptionPeriod,
  stripeTimestampToDate,
  getFeeBreakdownFromPaymentIntent,
} = require("../utils/stripe");
const { findOrderByOrderId } = require("../utils/orderId");
const Subscription = require("../models/userSubscription");
const PaymentHistory = require("../models/paymentHistory");
const FanPaymentHistory = require("../models/fanPaymentHistory");
const FanSubscription = require("../models/fanSubscription");
const Campaign = require("../models/campaign");
const User = require("../models/auth");
const logger = require("../utils/logger");

/**
 * Verifies a succeeded PaymentIntent matches order total and user.
 * Used when placing an order with paymentMethod "online".
 */
const verifyPaymentIntentForOrder = async (
  paymentIntentId,
  expectedTotalDollars,
  userId,
) => {
  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (
    paymentIntent.metadata?.userId &&
    String(paymentIntent.metadata.userId) !== String(userId)
  ) {
    return { error: "Payment does not belong to this account" };
  }

  if (paymentIntent.status !== "succeeded") {
    return {
      error: `Payment not completed. Current status: ${paymentIntent.status}`,
      status: paymentIntent.status,
    };
  }

  const expectedCents = dollarsToCents(expectedTotalDollars);
  const receivedCents = paymentIntent.amount_received ?? paymentIntent.amount;
  if (receivedCents < expectedCents) {
    return { error: "Payment amount is less than the order total" };
  }

  return { paymentIntent };
};

const handleStripeWebhook = async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return res.status(500).send("STRIPE_WEBHOOK_SECRET is not configured");
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).send("Missing stripe-signature header");
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const sub = event.data.object;

        if (sub?.metadata?.type === "create_campaign") {
          const campaignId = sub?.metadata.campaignId;
          if (!campaignId) return;

          const campaign = await Campaign.findById(campaignId);
          if (campaign && campaign.paymentStatus !== "paid") {
            campaign.paymentStatus = "paid";
            campaign.paymentIntentId = sub.id;
            await campaign.save();
          }
        }

        if (sub?.metadata?.type === "ai_subscription_credit_purchase" || sub?.metadata?.type === "credit_purchase") {
          const userId = sub?.metadata?.userId;
          const creditsToAdd = Number(sub?.metadata?.creditsToBuy) || 0;
          if (userId && creditsToAdd > 0) {
            const creditService = require("../services/credits/creditService");
            await creditService.addPurchasedCredits(
              userId,
              creditsToAdd,
              sub.id,
              `Purchased ${creditsToAdd} credits via Stripe Webhook`
            );
          }
        }
        break;

      }

      case "payment_intent.payment_failed": {
        const sub = event.data.object;

        if (sub?.metadata?.type === "create_campaign") {
          const campaignId = sub?.metadata.campaignId;
          if (!campaignId) return;

          await Campaign.findByIdAndUpdate(campaignId, {
            paymentStatus: "failed",
          });
        }

        if (sub?.metadata?.type === "ai_subscription_credit_purchase" || sub?.metadata?.type === "credit_purchase") {
          try {
            const AIPaymentHistory = require("../models/AIPaymentHistory");
            await AIPaymentHistory.findOneAndUpdate(
              { stripePaymentIntentId: sub.id },
              { status: "failed" }
            );
          } catch (err) {
            logger.error(`Could not mark AI payment ${sub.id} as failed: ${err.message}`);
          }
        }
        break;
      }


      case "charge.refunded": {
        const sub = event.data.object;

        if (sub.refunded && sub.payment_intent) {
          const AIPaymentHistory = require("../models/AIPaymentHistory");
          const aiPayment = await AIPaymentHistory.exists({ stripePaymentIntentId: sub.payment_intent });
          if (aiPayment) {
            await require("../services/credits/creditService").reversePurchasedCredits(sub.payment_intent, "refunded");
          }
        }

        if (sub?.metadata?.type === "create_campaign") {
          const campaignId = sub?.metadata.campaignId;
          if (!campaignId) return;

          await Campaign.findByIdAndUpdate(campaignId, {
            paymentStatus: "refunded",
          });
        }
        break;
      }

      case "charge.dispute.created": {
        const sub = event.data.object;

        if (sub.charge) {
          const charge = await getStripe().charges.retrieve(sub.charge);
          if (charge.payment_intent) {
            const AIPaymentHistory = require("../models/AIPaymentHistory");
            const aiPayment = await AIPaymentHistory.exists({ stripePaymentIntentId: charge.payment_intent });
            if (aiPayment) {
              await require("../services/credits/creditService").reversePurchasedCredits(charge.payment_intent, "disputed");
            }
          }
        }

        if (sub?.metadata?.type === "create_campaign") {
          const campaignId = sub?.metadata.campaignId;
          if (!campaignId) return;

          await Campaign.findOneAndUpdate(
            { paymentIntentId },
            { paymentStatus: "disputed" },
          );
        }
        break;
      }

      case "customer.subscription.created": {
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        if (sub.metadata?.type === "creator_subscription") {
          await handleCreatorSubscriptionUpdated(sub);
        } else {
          await handleSubscriptionUpdated(sub);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        if (sub.metadata?.type === "creator_subscription") {
          await handleCreatorSubscriptionDeleted(sub);
        } else {
          await handleSubscriptionDeleted(sub);
        }
        break;
      }

      case "customer.subscription.trial_will_end": {
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        if (
          invoice.parent?.subscription_details?.metadata?.type ===
          "creator_subscription"
        ) {
          await handleCreatorInvoicePaid(invoice);
        } else {
          await handleInvoicePaid(invoice);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        if (
          invoice.parent?.subscription_details?.metadata?.type ===
          "creator_subscription"
        ) {
          await handleCreatorInvoicePaymentFailed(invoice);
        } else {
          await handleInvoicePaymentFailed(invoice);
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`Stripe webhook handler failed: ${error.message}`);
    return res.status(500).json({ message: "We couldn't process this payment update." });
  }
};

async function handleSubscriptionUpdated(stripeSub) {
  const subscription = await Subscription.findOne({
    stripeSubscriptionId: stripeSub.id,
  });
  if (!subscription) return;

  subscription.status = stripeSub.status;

  const { currentPeriodStart, currentPeriodEnd } =
    getSubscriptionPeriod(stripeSub);
  if (currentPeriodStart) subscription.currentPeriodStart = currentPeriodStart;
  if (currentPeriodEnd) subscription.currentPeriodEnd = currentPeriodEnd;

  subscription.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;

  const trialStart = stripeTimestampToDate(stripeSub.trial_start);
  const trialEnd = stripeTimestampToDate(stripeSub.trial_end);
  if (trialStart) subscription.trialStart = trialStart;
  if (trialEnd) subscription.trialEnd = trialEnd;

  await subscription.save();

  const user = await User.findById(subscription.userId);
  if (user) {
    user.activeSubscriptionId = subscription._id;
    user.activeSubscriptionExpiresAt = subscription.currentPeriodEnd;
    await user.save();
  }
}

async function handleSubscriptionDeleted(stripeSub) {
  const subscription = await Subscription.findOne({
    stripeSubscriptionId: stripeSub.id,
  });
  if (!subscription) return;

  subscription.status = "canceled";
  subscription.canceledAt = new Date();
  await subscription.save();

  await User.findByIdAndUpdate(subscription.userId, {
    activeSubscriptionId: null,
    activeSubscriptionExpiresAt: null,
  });
}

async function handleInvoicePaid(invoice) {
  if (!invoice.parent?.subscription_details?.subscription) return;

  const stripeSubscriptionId = invoice.parent.subscription_details.subscription;

  const subscription = await Subscription.findOne({
    stripeSubscriptionId: stripeSubscriptionId,
  });
  if (!subscription) return;

  const stripeSub =
    await getStripe().subscriptions.retrieve(stripeSubscriptionId);

  subscription.status = stripeSub.status;

  const { currentPeriodStart, currentPeriodEnd } =
    getSubscriptionPeriod(stripeSub);
  if (currentPeriodStart) subscription.currentPeriodStart = currentPeriodStart;
  if (currentPeriodEnd) subscription.currentPeriodEnd = currentPeriodEnd;

  const hasDiscountOnThisInvoice =
    Array.isArray(invoice.total_discount_amounts) &&
    invoice.total_discount_amounts.length > 0;

  if (subscription.hasDiscountApplied && !hasDiscountOnThisInvoice) {
    subscription.hasDiscountApplied = false;
  }

  await subscription.save();

  await User.findByIdAndUpdate(subscription.userId, {
    activeSubscriptionId: subscription._id,
    activeSubscriptionExpiresAt: subscription.currentPeriodEnd,
  });


  const alreadyLogged = await PaymentHistory.findOne({
    stripeInvoiceId: invoice.id,
  });

  if (!alreadyLogged) {
    const fullInvoice = await getStripe().invoices.retrieve(invoice.id, {
      expand: ["payments.data.payment.payment_intent"],
    });

    const paymentIntent =
      fullInvoice.payments?.data?.[0]?.payment?.payment_intent ?? null;
    const paymentIntentId =
      typeof paymentIntent === "string"
        ? paymentIntent
        : (paymentIntent?.id ?? null);

    const isTrialInvoice = invoice.amount_paid === 0;

    await PaymentHistory.create({
      user: subscription.userId,
      subscription: subscription._id,
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: paymentIntentId,
      planName: subscription.plan,
      amountInCents: invoice.amount_paid,
      amount: centsToDollars(invoice.amount_paid),
      currency: invoice.currency,
      status: isTrialInvoice ? "trial_start" : "paid",
      description: isTrialInvoice
        ? `${subscription.plan} plan - free trial started`
        : `Invoice paid for ${subscription.plan} plan`,
      paidAt: isTrialInvoice
        ? null
        : new Date(invoice.status_transitions.paid_at * 1000),
      hasDiscountApplied: hasDiscountOnThisInvoice,
      discountPercentage: invoice.total_discount_amounts?.[0]?.amount ?? 0,
    });
  }
}

async function handleInvoicePaymentFailed(invoice) {
  if (!invoice.parent?.subscription_details?.subscription) return;

  const stripeSubscriptionId = invoice.parent.subscription_details.subscription;

  const subscription = await Subscription.findOne({
    stripeSubscriptionId: stripeSubscriptionId,
  });
  if (!subscription) return;

  subscription.status = "past_due";
  await subscription.save();

  const alreadyLogged = await PaymentHistory.findOne({
    stripeInvoiceId: invoice.id,
  });

  if (!alreadyLogged) {
    await PaymentHistory.create({
      user: subscription.userId,
      subscription: subscription._id,
      stripeInvoiceId: invoice.id,
      planName: subscription.plan,
      amountInCents: invoice.amount_due,
      amount: centsToDollars(invoice.amount_due),
      currency: invoice.currency,
      status: "failed",
      description: `Payment failed for ${subscription.plan} plan`,
      paidAt: null,
    });
  }
}

// Fan subscription

async function handleCreatorSubscriptionUpdated(stripeSub) {
  const fanSub = await FanSubscription.findOne({
    stripeSubscriptionId: stripeSub.id,
  });
  if (!fanSub) return;

  fanSub.status = stripeSub.status;
  fanSub.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;

  const { currentPeriodStart, currentPeriodEnd } =
    getSubscriptionPeriod(stripeSub);
  if (currentPeriodStart) fanSub.currentPeriodStart = currentPeriodStart;
  if (currentPeriodEnd) fanSub.currentPeriodEnd = currentPeriodEnd;

  await fanSub.save();
}

async function handleCreatorSubscriptionDeleted(stripeSub) {
  const fanSub = await FanSubscription.findOne({
    stripeSubscriptionId: stripeSub.id,
  });
  if (!fanSub) return;

  fanSub.status = "canceled";
  fanSub.canceledAt = new Date();
  await fanSub.save();
}

async function handleCreatorInvoicePaid(invoice) {
  if (!invoice.parent?.subscription_details?.subscription) return;

  const stripeSubscriptionId = invoice.parent.subscription_details.subscription;

  const fanSub = await FanSubscription.findOne({
    stripeSubscriptionId,
  });
  if (!fanSub) return;

  const stripeSub =
    await getStripe().subscriptions.retrieve(stripeSubscriptionId);

  fanSub.status = stripeSub.status;

  const { currentPeriodStart, currentPeriodEnd } =
    getSubscriptionPeriod(stripeSub);
  if (currentPeriodStart) fanSub.currentPeriodStart = currentPeriodStart;
  if (currentPeriodEnd) fanSub.currentPeriodEnd = currentPeriodEnd;

  await fanSub.save();

  if (invoice.amount_paid === 0) return;

  const alreadyLogged = await FanPaymentHistory.findOne({
    stripeInvoiceId: invoice.id,
  });
  if (alreadyLogged) return;

  const fullInvoice = await getStripe().invoices.retrieve(invoice.id, {
    expand: ["payments.data.payment.payment_intent"],
  });

  const paymentIntent =
    fullInvoice.payments?.data?.[0]?.payment?.payment_intent ?? null;
  const paymentIntentId =
    typeof paymentIntent === "string"
      ? paymentIntent
      : (paymentIntent?.id ?? null);

  const { stripeFeeInCents, netAmountInCents } =
    await getFeeBreakdownFromPaymentIntent(paymentIntent ?? paymentIntentId);

  await FanPaymentHistory.create({
    fanId: fanSub.fanId,
    creatorId: fanSub.creatorId,
    fanSubscriptionId: fanSub._id,
    stripeInvoiceId: invoice.id,
    stripePaymentIntentId: paymentIntentId,
    amountInCents: invoice.amount_paid,
    amount: centsToDollars(invoice.amount_paid),
    stripeFeeInCents,
    stripeFee: centsToDollars(stripeFeeInCents),
    netAmountInCents,
    netAmount: centsToDollars(netAmountInCents),
    currency: invoice.currency,
    status: "paid",
    description: `Creator subscription payment`,
    paidAt: new Date(invoice.status_transitions.paid_at * 1000),
  });
}

async function handleCreatorInvoicePaymentFailed(invoice) {
  if (!invoice.parent?.subscription_details?.subscription) return;

  const fanSub = await FanSubscription.findOne({
    stripeSubscriptionId: invoice.parent.subscription_details.subscription,
  });
  if (!fanSub) return;

  fanSub.status = "past_due";
  await fanSub.save();

  // Duplicate check
  const alreadyLogged = await FanPaymentHistory.findOne({
    stripeInvoiceId: invoice.id,
  });

  if (alreadyLogged) return;

  // Failed history create
  await FanPaymentHistory.create({
    fanId: fanSub.fanId,
    creatorId: fanSub.creatorId,
    fanSubscriptionId: fanSub._id,
    stripeInvoiceId: invoice.id,
    amountInCents: invoice.amount_due,
    amount: centsToDollars(invoice.amount_due),
    currency: invoice.currency,
    status: "failed",
    description: `Creator subscription payment failed`,
    paidAt: null,
  });
}

module.exports = {
  handleStripeWebhook,
  verifyPaymentIntentForOrder,
};
