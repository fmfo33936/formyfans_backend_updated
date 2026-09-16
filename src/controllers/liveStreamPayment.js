const LiveStream = require("../models/liveStream");
const LiveStreamPayment = require("../models/liveStreamPayment");
const LiveStreamComment = require("../models/liveStreamComment");
const { schemaValidator } = require("../utils/validator");
const {
  createFanbugIntentSchema,
  confirmFanbugSchema,
} = require("../utils/validations");
const {
  getStripe,
  dollarsToCents,
  centsToDollars,
  getChargeWithBalanceTransaction,
} = require("../utils/stripe");

const COMMENT_AUTHOR_FIELDS = "_id firstName lastName username image";
const PAYER_FIELDS = "_id firstName lastName username image";
const STRIPE_CURRENCY = "usd";

const sendError = (res, error) =>
  res.status(error.statusCode || 500).json({
    status: "error",
    message: error.message || "Something went wrong",
  });

const formatFanbugComment = (amount) => {
  const dollars = Number(amount).toFixed(2);
  return `sent a $${dollars} Fanbug`;
};

const findActiveStream = async (streamId) =>
  LiveStream.findOne({ _id: streamId, status: "live" });

const createFanbugIntent = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    createFanbugIntentSchema,
  );
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const stream = await findActiveStream(req.params.streamId);
    if (!stream) {
      return res.status(404).json({
        status: "error",
        message: "Active live stream not found",
      });
    }

    const amountInCents = dollarsToCents(validatedData.amount);
    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: STRIPE_CURRENCY,
      automatic_payment_methods: { enabled: true },
      metadata: {
        type: "live_stream_fanbug",
        streamId: stream._id.toString(),
        payerId: req.user._id.toString(),
        creatorId: stream.creator.toString(),
        coHostId: stream.coHost?.toString() || "",
        message: validatedData.message || "",
      },
    });

    return res.status(200).json({
      status: "success",
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: centsToDollars(amountInCents),
        amountInCents,
        currency: STRIPE_CURRENCY,
      },
    });
  } catch (err) {
    return sendError(res, err);
  }
};

const confirmFanbug = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, confirmFanbugSchema);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const stream = await findActiveStream(req.params.streamId);
    if (!stream) {
      return res.status(404).json({
        status: "error",
        message: "Active live stream not found",
      });
    }

    const existing = await LiveStreamPayment.findOne({
      stripePaymentIntentId: validatedData.paymentIntentId,
    });
    if (existing) {
      await existing.populate("payer", PAYER_FIELDS);
      return res.status(200).json({
        status: "success",
        message: "Fanbug already recorded",
        data: existing,
      });
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.retrieve(
      validatedData.paymentIntentId,
    );

    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({
        status: "error",
        message: "Payment has not succeeded yet",
      });
    }

    const meta = paymentIntent.metadata || {};
    if (meta.type !== "live_stream_fanbug") {
      return res.status(400).json({
        status: "error",
        message: "Invalid payment type",
      });
    }
    if (meta.streamId !== stream._id.toString()) {
      return res.status(400).json({
        status: "error",
        message: "Payment does not belong to this stream",
      });
    }
    if (meta.payerId !== req.user._id.toString()) {
      return res.status(403).json({
        status: "error",
        message: "Payment does not belong to this user",
      });
    }

    const amountInCents = paymentIntent.amount;
    const amount = centsToDollars(amountInCents);
    const message = (meta.message || "").trim();

    let stripeFeeInCents = 0;
    let netAmountInCents = 0;
    try {
      if (paymentIntent.latest_charge) {
        let bt = null;
        for (let attempt = 1; attempt <= 3 && !bt; attempt++) {
          const charge = await getChargeWithBalanceTransaction(
            paymentIntent.latest_charge,
          );
          bt = charge.balance_transaction;

          if (!bt) {
            await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second wait
          }
        }

        if (bt) {
          stripeFeeInCents = bt.fee;
          netAmountInCents = bt.net;
        } else {
          console.info(
            "No balance transaction found after retries for charge:",
            paymentIntent.latest_charge,
          );
        }
      }
    } catch (btError) {
      console.error("Failed to fetch balance transaction:", btError.message);
    }

    let payment;
    try {
      payment = await LiveStreamPayment.create({
        stream: stream._id,
        payer: req.user._id,
        creator: stream.creator,
        coHost: stream.coHost || null,
        amount,
        amountInCents,
        stripeFee: centsToDollars(stripeFeeInCents),
        stripeFeeInCents,
        netAmount: centsToDollars(netAmountInCents),
        netAmountInCents,
        currency: paymentIntent.currency || STRIPE_CURRENCY,
        stripePaymentIntentId: paymentIntent.id,
        message,
        paidAt: new Date(),
      });
    } catch (createError) {
      if (createError?.code === 11000) {
        const duplicate = await LiveStreamPayment.findOne({
          stripePaymentIntentId: paymentIntent.id,
        }).populate("payer", PAYER_FIELDS);
        return res.status(200).json({
          status: "success",
          message: "Fanbug already recorded",
          data: duplicate,
        });
      }
      throw createError;
    }

    await LiveStream.updateOne(
      { _id: stream._id },
      {
        $inc: {
          fanbugTotalAmount: amount,
          fanbugTotalCents: amountInCents,
          fanbugCount: 1,
        },
      },
    );

    const comment = await LiveStreamComment.create({
      stream: stream._id,
      author: req.user._id,
      content: formatFanbugComment(amount),
      type: "fanbug",
      fanbugAmount: amount,
      fanbugMessage: message,
      fanbugPayment: payment._id,
    });
    await comment.populate("author", COMMENT_AUTHOR_FIELDS);

    req.app
      .get("socketio")
      ?.to(`livestream_${stream._id}`)
      .emit("livestream_comment", comment);

    req.app
      .get("socketio")
      ?.to(`livestream_${stream._id}`)
      .emit("livestream_fanbug", {
        streamId: stream._id,
        amountInCents,
        payment,
        comment,
      });

    await payment.populate("payer", PAYER_FIELDS);

    return res.status(201).json({
      status: "success",
      message: "Fanbug sent successfully",
      data: {
        payment,
        comment,
      },
    });
  } catch (err) {
    return sendError(res, err);
  }
};

const listFanbugs = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const filter = { stream: req.params.streamId };
    const [payments, total] = await Promise.all([
      LiveStreamPayment.find(filter)
        .populate("payer", PAYER_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LiveStreamPayment.countDocuments(filter),
    ]);

    return res.status(200).json({
      status: "success",
      data: payments,
      pagination: {
        page,
        limit,
        total,
        hasNextPage: skip + payments.length < total,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports = {
  createFanbugIntent,
  confirmFanbug,
  listFanbugs,
};
