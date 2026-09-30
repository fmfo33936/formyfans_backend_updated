const mongoose = require("mongoose");
const creditService = require("../services/credits/creditService");
const CreditPricing = require("../models/CreditPricing");
const CreditTransaction = require("../models/CreditTransaction");
const AIPaymentHistory = require("../models/AIPaymentHistory");
const User = require("../models/auth");
const { getStripe } = require("../utils/stripe");
const { schemaValidator } = require("../utils/validator");
const {
  purchaseCreditsSchema,
  calculateCreditPriceSchema,
  verifyCreditPaymentSchema,
  updatePricingSchema,
} = require("../utils/validations");
const { successHelper, errorHelper } = require("../utils/helper");
const logger = require("../utils/logger");

const getStripeReturnUrl = () => process.env.STRIPE_RETURN_URL || undefined;

/**
 * Returns current user credit balance (available & reserved).
 * GET /api/credits/balance
 */
const getBalance = async (req, res, next) => {
  try {
    const userCredit = await creditService.getOrCreateUserCredit(req.user._id);
    return successHelper(
      res,
      {
        balance: userCredit.balance,
        reserved: userCredit.reserved,
        availableBalance: userCredit.availableBalance,
        totalPurchased: userCredit.totalPurchased,
        totalSpent: userCredit.totalSpent,
      },
      "Here's your current credit balance.",
      200
    );
  } catch (err) {
    return next(err);
  }
};

/**
 * Returns paginated user credit transaction history.
 * GET /api/credits/transactions
 */
const getTransactions = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const filter = { userId: req.user._id };
    const [transactions, totalCount] = await Promise.all([
      CreditTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("relatedGeneration", "type prompt status"),
      CreditTransaction.countDocuments(filter),
    ]);

    return successHelper(
      res,
      {
        data: transactions,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      },
      "Here's your credit activity.",
      200
    );
  } catch (err) {
    return next(err);
  }
};

/**
 * Returns active credit pricing rules & single dynamic subscription plan.
 * GET /api/credits/pricing
 */
const getPricing = async (req, res, next) => {
  try {
    const pricing = await CreditPricing.getActivePricing();
    return successHelper(res, pricing, "Here are the current credit prices.", 200);
  } catch (err) {
    return next(err);
  }
};

/**
 * Calculates dynamic price for a given credit amount.
 * POST /api/credits/calculate-price
 */
const calculatePrice = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(req.body, calculateCreditPriceSchema);
    if (error) {
      return errorHelper(res, null, error, 400);
    }

    const pricing = await CreditPricing.getActivePricing();
    const credits = validatedData.credits;
    if (credits < pricing.minCredits || credits > pricing.maxCredits) {
      return errorHelper(res, null, `Please choose between ${pricing.minCredits} and ${pricing.maxCredits} credits.`, 400);
    }
    const priceUsd = Number((credits * pricing.pricePerCredit).toFixed(2));

    return successHelper(
      res,
      {
        credits,
        priceUsd,
        pricePerCredit: pricing.pricePerCredit,
        planName: pricing.planName,
      },
      "Here's how much those credits cost.",
      200
    );
  } catch (err) {
    return next(err);
  }
};

/**
 * Creates Stripe PaymentIntent for dynamic AI Subscription / Credit purchase.
 * POST /api/credits/purchase
 */
const createPurchasePaymentIntent = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(req.body, purchaseCreditsSchema);
    if (error) {
      return errorHelper(res, null, error, 400);
    }

    const pricing = await CreditPricing.getActivePricing();
    const { credits, paymentMethodId } = validatedData;
    const creditsToBuy = credits;

    if (creditsToBuy < pricing.minCredits) {
      return errorHelper(
        res,
        null,
        `Please choose at least ${pricing.minCredits} credits.`,
        400
      );
    }
    if (creditsToBuy > pricing.maxCredits) {
      return errorHelper(res, null, `Please choose no more than ${pricing.maxCredits} credits.`, 400);
    }

    const priceUsd = Number((creditsToBuy * pricing.pricePerCredit).toFixed(2));
    const finalAmountCents = Math.round(priceUsd * 100);

    if (finalAmountCents < 50) {
      return errorHelper(res, null, "Please choose enough credits to reach the $0.50 minimum.", 400);
    }

    const userId = req.user._id;
    const stripe = getStripe();

    const userDoc = await User.findById(userId).select("+stripeCustomerId email");
    let stripeCustomerId = userDoc?.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userDoc?.email,
        metadata: { userId: userId.toString() },
      });
      stripeCustomerId = customer.id;
      await User.findByIdAndUpdate(userId, { stripeCustomerId });
    }

    let pmId = paymentMethodId;
    if (!pmId && stripeCustomerId) {
      try {
        const customer = await stripe.customers.retrieve(stripeCustomerId);
        if (customer && customer.invoice_settings?.default_payment_method) {
          pmId = typeof customer.invoice_settings.default_payment_method === "string"
            ? customer.invoice_settings.default_payment_method
            : customer.invoice_settings.default_payment_method?.id;
        }
      } catch (custErr) {
        logger.warn(`Could not load the saved payment method for user ${userId}: ${custErr.message}`);
      }
    }

    if (pmId) {
      try {
        await stripe.paymentMethods.attach(pmId, { customer: stripeCustomerId });
      } catch (attachErr) {
        logger.warn(`Could not attach payment method for user ${userId}: ${attachErr.message}`);
      }
    }

    const piPayload = {
      amount: finalAmountCents,
      currency: "usd",
      customer: stripeCustomerId,
      metadata: {
        type: "ai_subscription_credit_purchase",
        userId: userId.toString(),
        creditsToBuy: creditsToBuy.toString(),
        priceUsd: priceUsd.toString(),
        planName: pricing.planName,
      },
    };

    if (pmId) {
      piPayload.payment_method = pmId;
      piPayload.confirm = true;
      piPayload.off_session = true;
      const returnUrl = getStripeReturnUrl();
      if (returnUrl) piPayload.return_url = returnUrl;
    }

    const requestKey = validatedData.purchaseRequestId || req.get("Idempotency-Key");
    const paymentIntent = await stripe.paymentIntents.create(
      piPayload,
      requestKey ? { idempotencyKey: `ai-credit-${userId}-${requestKey}` } : undefined
    );
    const isSucceeded = paymentIntent.status === "succeeded";

    await AIPaymentHistory.create({
      userId,
      stripePaymentIntentId: paymentIntent.id,
      stripeCustomerId,
      planName: pricing.planName,
      creditsPurchased: creditsToBuy,
      amountPaidUsd: priceUsd,
      status: isSucceeded ? "succeeded" : "pending",
      paidAt: isSucceeded ? new Date() : null,
    });

    if (isSucceeded) {
      const updatedCredit = await creditService.addPurchasedCredits(
        userId,
        creditsToBuy,
        paymentIntent.id,
        `Purchased ${creditsToBuy} credits directly via Stripe`
      );

      return successHelper(
        res,
        {
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
          credits: creditsToBuy,
          priceUsd,
          addedCredits: creditsToBuy,
          newBalance: updatedCredit.balance,
          availableBalance: updatedCredit.availableBalance,
          planName: pricing.planName,
        },
        "Payment complete! Your credits are ready to use.",
        200
      );
    }

    return successHelper(
      res,
      {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        credits: creditsToBuy,
        priceUsd,
        planName: pricing.planName,
      },
      "Your payment is ready. Complete it to add your credits.",
      201
    );
  } catch (err) {
    return next(err);
  }
};


/**
 * Verifies Stripe payment on server side and allocates platform credits.
 * POST /api/credits/verify-payment
 */
const verifyPayment = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(req.body, verifyCreditPaymentSchema);
    if (error) {
      return errorHelper(res, null, error, 400);
    }

    const { paymentIntentId } = validatedData;
    const stripe = getStripe();

    let paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!paymentIntent) {
      return errorHelper(res, null, "We couldn't find that payment. Please check it and try again.", 404);
    }

    const metadataUserId = paymentIntent.metadata?.userId;
    if (
      metadataUserId !== req.user._id.toString() ||
      paymentIntent.metadata?.type !== "ai_subscription_credit_purchase"
    ) {
      return errorHelper(res, null, "This payment isn't linked to your account.", 403);
    }

    const paymentRecord = await AIPaymentHistory.findOne({
      stripePaymentIntentId: paymentIntent.id,
      userId: req.user._id,
    });
    if (!paymentRecord) {
      return errorHelper(res, null, "We couldn't verify this credit payment. Please contact support.", 400);
    }
    if (["refunded", "disputed"].includes(paymentRecord.status)) {
      return errorHelper(res, null, "This payment was reversed, so credits can't be added from it.", 400);
    }

    if (paymentIntent.status !== "succeeded") {
      let pmToUse = validatedData.paymentMethodId;
      if (!pmToUse && paymentIntent.customer) {
        try {
          const customer = await stripe.customers.retrieve(paymentIntent.customer);
          if (customer && customer.invoice_settings?.default_payment_method) {
            pmToUse = typeof customer.invoice_settings.default_payment_method === "string"
              ? customer.invoice_settings.default_payment_method
              : customer.invoice_settings.default_payment_method?.id;
          }
        } catch (error) {
          logger.warn(`Could not load the saved payment method during payment verification: ${error.message}`);
        }
      }

      if (pmToUse && (paymentIntent.status === "requires_payment_method" || paymentIntent.status === "requires_confirmation")) {
        try {
          paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
            payment_method: pmToUse,
            ...(getStripeReturnUrl() ? { return_url: getStripeReturnUrl() } : {}),
          });
        } catch (confirmErr) {
          logger.warn(`Stripe could not confirm payment ${paymentIntentId}: ${confirmErr.message}`);
        }
      }
    }

    if (paymentIntent.status !== "succeeded") {
      return errorHelper(
        res,
        null,
        "Your payment isn't complete yet. Please finish it and try again.",
        400
      );
    }

    const creditsToAdd = Number(paymentIntent.metadata?.creditsToBuy) || 0;
    const receivedCents = paymentIntent.amount_received || paymentIntent.amount;
    const expectedCents = Math.round(paymentRecord.amountPaidUsd * 100);
    if (creditsToAdd <= 0 || creditsToAdd !== paymentRecord.creditsPurchased || receivedCents < expectedCents) {
      return errorHelper(res, null, "We couldn't confirm the credits for this payment. Please contact support.", 400);
    }

    const updatedCredit = await creditService.addPurchasedCredits(
      req.user._id,
      creditsToAdd,
      paymentIntent.id,
      `Purchased ${creditsToAdd} credits via Stripe`
    );

    return successHelper(
      res,
      {
        addedCredits: creditsToAdd,
        newBalance: updatedCredit.balance,
        availableBalance: updatedCredit.availableBalance,
      },
      "Your credits are ready to use!",
      200
    );
  } catch (err) {
    return next(err);
  }
};

/**
 * Returns separate user AI subscription & payment history.
 * GET /api/credits/history
 */
const getPaymentHistory = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const filter = { userId: req.user._id };
    const [history, totalCount] = await Promise.all([
      AIPaymentHistory.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      AIPaymentHistory.countDocuments(filter),
    ]);

    return successHelper(
      res,
      {
        data: history,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      },
      "Here's your payment history.",
      200
    );
  } catch (err) {
    return next(err);
  }
};

/**
 * Admin endpoint to update credit pricing & conversion parameters.
 * PUT /api/credits/pricing
 */
const updatePricing = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(req.body, updatePricingSchema);
    if (error) {
      return errorHelper(res, null, error, 400);
    }

    let pricing = await CreditPricing.findOne({ isActive: true }).sort({ updatedAt: -1 });
    if (!pricing) {
      pricing = new CreditPricing(validatedData);
    } else {
      Object.assign(pricing, validatedData);
    }

    await pricing.save();
    return successHelper(res, pricing, "Credit pricing updated successfully", 200);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getBalance,
  getTransactions,
  getPricing,
  calculatePrice,
  createPurchasePaymentIntent,
  verifyPayment,
  getPaymentHistory,
  updatePricing,
};
