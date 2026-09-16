const Stripe = require("stripe");

let stripeClient = null;

const getStripe = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }
  return stripeClient;
};

const dollarsToCents = (amount) => Math.round(Number(amount) * 100);

const centsToDollars = (cents) => Math.round(Number(cents)) / 100;

const stripeTimestampToDate = (seconds) => {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const date = new Date(Number(seconds) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Stripe Basil (2025-03-31+) moved period fields to subscription items. */
const getSubscriptionPeriod = (stripeSubscription) => {
  const items = stripeSubscription?.items?.data;

  if (Array.isArray(items) && items.length > 0) {
    const starts = items
      .map((item) => item.current_period_start)
      .filter((ts) => ts != null);
    const ends = items
      .map((item) => item.current_period_end)
      .filter((ts) => ts != null);

    if (starts.length > 0 && ends.length > 0) {
      return {
        currentPeriodStart: stripeTimestampToDate(Math.min(...starts)),
        currentPeriodEnd: stripeTimestampToDate(Math.min(...ends)),
      };
    }
  }

  if (
    stripeSubscription?.current_period_start != null &&
    stripeSubscription?.current_period_end != null
  ) {
    return {
      currentPeriodStart: stripeTimestampToDate(
        stripeSubscription.current_period_start
      ),
      currentPeriodEnd: stripeTimestampToDate(
        stripeSubscription.current_period_end
      ),
    };
  }

  if (
    stripeSubscription?.trial_start != null &&
    stripeSubscription?.trial_end != null
  ) {
    return {
      currentPeriodStart: stripeTimestampToDate(stripeSubscription.trial_start),
      currentPeriodEnd: stripeTimestampToDate(stripeSubscription.trial_end),
    };
  }

  return { currentPeriodStart: null, currentPeriodEnd: null };
};


const getChargeWithBalanceTransaction = async (chargeId) => {
  const stripe = getStripe();
  return stripe.charges.retrieve(chargeId, {
    expand: ["balance_transaction"],
  });
};


const getFeeBreakdownFromPaymentIntent = async (paymentIntentRefOrId) => {
  let stripeFeeInCents = 0;
  let netAmountInCents = 0;

  try {
    const stripe = getStripe();
    let latestCharge = null;

    if (
      paymentIntentRefOrId &&
      typeof paymentIntentRefOrId === "object" &&
      paymentIntentRefOrId.latest_charge
    ) {
      latestCharge = paymentIntentRefOrId.latest_charge;
    } else if (typeof paymentIntentRefOrId === "string") {
      const fullPi = await stripe.paymentIntents.retrieve(paymentIntentRefOrId);
      latestCharge = fullPi.latest_charge;
    }

    if (!latestCharge) return { stripeFeeInCents, netAmountInCents };

    let bt = null;
    for (let attempt = 1; attempt <= 3 && !bt; attempt++) {
      const charge = await getChargeWithBalanceTransaction(latestCharge);
      bt = charge.balance_transaction;
      if (!bt) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (bt) {
      stripeFeeInCents = bt.fee;
      netAmountInCents = bt.net;
    }
  } catch (err) {
    console.error("Failed to fetch balance transaction:", err.message);
  }

  return { stripeFeeInCents, netAmountInCents };
};

module.exports = {
  getStripe,
  dollarsToCents,
  centsToDollars,
  stripeTimestampToDate,
  getSubscriptionPeriod,
  getChargeWithBalanceTransaction,
  getFeeBreakdownFromPaymentIntent,
};
