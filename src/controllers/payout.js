const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const mongoose = require("mongoose");
const User = require("../models/auth");
const Deal = require("../models/deal");
const LiveStreamPayment = require("../models/liveStreamPayment");
const FanPaymentHistory = require("../models/fanPaymentHistory"); 

const checkStripeOnboardingStatus = async (req, res) => {
  try {
    const vendor = await User.findOne({ _id: req.user.id });

    if (!vendor.stripeConnectAccountId) {
      vendor.stripeOnboardingComplete = false;
      await vendor.save();

      return res.json({
        success: true,
        message: {
          en: "Your Stripe account has not been created yet. Please start the Stripe onboarding process.",
          nl: "Uw Stripe-account is nog niet aangemaakt. Start het Stripe-onboardingproces.",
        },
        onboarded: false,
        accountDetails: {
          details_submitted: false,
          charges_enabled: false,
          payouts_enabled: false,
        },
        account: null,
      });
    }
    const account = await stripe.accounts.retrieve(
      vendor.stripeConnectAccountId,
    );

    const onboarded =
      account.details_submitted &&
      account.charges_enabled &&
      account.payouts_enabled;

    vendor.stripeOnboardingComplete = onboarded;
    await vendor.save();

    let message = {
      en: "",
      nl: "",
    };

    if (!account.details_submitted) {
      message = {
        en: "Stripe onboarding has not been completed yet. Please complete the onboarding process.",
        nl: "De Stripe-onboarding is nog niet voltooid. Voltooi eerst het onboardingproces.",
      };
    } else if (
      account.details_submitted &&
      !account.charges_enabled &&
      !account.payouts_enabled
    ) {
      message = {
        en: "Your Stripe account is under review or requires additional verification before payments and payouts can be enabled.",
        nl: "Uw Stripe-account wordt momenteel gecontroleerd of vereist aanvullende verificatie voordat betalingen en uitbetalingen kunnen worden ingeschakeld.",
      };
    } else if (
      account.details_submitted &&
      account.charges_enabled &&
      !account.payouts_enabled
    ) {
      message = {
        en: "Payments are enabled, but payouts are still pending Stripe verification.",
        nl: "Betalingen zijn ingeschakeld, maar uitbetalingen wachten nog op verificatie door Stripe.",
      };
    } else if (
      account.details_submitted &&
      !account.charges_enabled &&
      account.payouts_enabled
    ) {
      message = {
        en: "Payouts are enabled, but payment processing is still pending Stripe verification.",
        nl: "Uitbetalingen zijn ingeschakeld, maar betalingsverwerking wacht nog op verificatie door Stripe.",
      };
    } else if (
      account.details_submitted &&
      account.charges_enabled &&
      account.payouts_enabled
    ) {
      message = {
        en: "Your Stripe account has been successfully verified and is ready to receive payments and payouts.",
        nl: "Uw Stripe-account is succesvol geverifieerd en klaar om betalingen en uitbetalingen te ontvangen.",
      };
    } else {
      message = {
        en: "Unable to determine Stripe account status.",
        nl: "Kan de status van het Stripe-account niet bepalen.",
      };
    }

    return res.json({
      success: true,
      message,
      onboarded,
      accountDetails: {
        details_submitted: account.details_submitted,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
      },
      account,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const connectVendorStripe = async (req, res) => {
  try {
    const vendor = await User.findOne({ _id: req.user.id });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    // Reuse existing account
    if (vendor.stripeConnectAccountId) {
      return res.json({
        success: true,
        stripeConnectAccountId: vendor.stripeConnectAccountId,
      });
    }

    const account = await stripe.accounts.create({
      type: "express",
      email: req.user.email,
      capabilities: {
        transfers: { requested: true },
      },
    });

    vendor.stripeConnectAccountId = account.id;
    await vendor.save();

    res.json({
      success: true,
      stripeConnectAccountId: account.id,
    });
  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getStripeOnboardingLink = async (req, res) => {
  try {
    const vendor = await User.findOne({ _id: req.user.id });
    if (!vendor?.stripeConnectAccountId) {
      return res.status(400).json({
        success: false,
        message: "Connect Stripe first",
      });
    }

    const accountLink = await stripe.accountLinks.create({
      account: vendor.stripeConnectAccountId,
      refresh_url: "https://creator-hub-stg.formyfansonly.com/succes",
      return_url: "https://creator-hub-stg.formyfansonly.com/succes",
      type: "account_onboarding",
    });

    res.json({
      success: true,
      url: accountLink.url,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getPayouts = async (req, res) => {
  try {
    const userId = req.user._id;

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [pending, active, history] = await Promise.all([
      Deal.find({
        receiver: userId,
        status: "completed",
        completedAt: { $gt: oneWeekAgo },
        isRecieverPaid: false,
      })
        .populate("sender", "name profileImage")
        .populate("receiver", "name profileImage")
        .sort({ completedAt: -1 }),

      Deal.find({
        receiver: userId,
        status: "completed",
        completedAt: { $lte: oneWeekAgo },
        isRecieverPaid: false,
      })
        .populate("sender", "name profileImage")
        .populate("receiver", "name profileImage")
        .sort({ completedAt: -1 }),

      Deal.find({
        receiver: userId,
        status: "completed",
        // completedAt: { $lte: oneWeekAgo },
        isRecieverPaid: true,
      })
        .populate("sender", "name profileImage")
        .populate("receiver", "name profileImage")
        .sort({ completedAt: -1 }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        pending,
        active,
        history,
      },
    });
  } catch (error) {
    console.error("getPayouts error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const payoutDeals = async (req, res) => {
  try {
    const { dealIds } = req.body;

    if (!dealIds?.length) {
      return res.status(400).json({
        success: false,
        message: "Deal ids are required",
      });
    }

    const deals = await Deal.find({
      _id: { $in: dealIds },
      status: "completed",
      isRecieverPaid: false,
    }).populate("receiver");

    if (!deals.length) {
      return res.status(404).json({
        success: false,
        message: "No eligible deals found",
      });
    }

    const receiverId = deals[0].receiver._id.toString();


    const allBelongToSameReceiver = deals.every(
      (deal) => deal.receiver._id.toString() === receiverId,
    );

  

    if (!allBelongToSameReceiver) {
      return res.status(400).json({
        success: false,
        message: "All selected deals must belong to the same creator",
      });
    }

    const receiver = deals[0].receiver;

    if (!receiver?.stripeConnectAccountId) {
      return res.status(400).json({
        success: false,
        message: "Creator has not connected Stripe account",
      });
    }

    let totalPayoutAmount = 0;
    const AdminSettings = await require("../models/adminSettings").findOne();
    const payoutBreakdown = deals.map((deal) => {
      const amount = Number(deal.amount || 0);
      const percentage = Number(AdminSettings?.dealsPayoutPercentage || 0);
      const deductionAmount = (amount * percentage) / 100;
      const paidAmount = amount - deductionAmount;
      totalPayoutAmount += paidAmount;
      return {
        dealId: deal._id,
        amount,
        percentage,
        deductionAmount,
        paidAmount,
      };
    });

 

    if (totalPayoutAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payout amount",
      });
    }

    const transfer = await stripe.transfers.create({
      amount: Math.round(totalPayoutAmount * 100),
      currency: "usd",
      destination: receiver.stripeConnectAccountId,
      metadata: {
        receiverId: receiver._id.toString(),
        dealIds: dealIds.join(","),
      },
    });

    const paidAt = new Date();

    const bulkOperations = payoutBreakdown.map((item) => ({
      updateOne: {
        filter: {
          _id: item.dealId,
        },
        update: {
          $set: {
            isRecieverPaid: true,
            paidAmount: item.paidAmount,
            paidAt,
            transferId: transfer.id,
          },
        },
      },
    }));

    await Deal.bulkWrite(bulkOperations);

    return res.status(200).json({
      success: true,
      message: "Payout sent successfully",
      data: {
        transferId: transfer.id,
        totalPayoutAmount,
        dealCount: deals.length,
        payoutBreakdown,
      },
    });
  } catch (error) {
    console.error("payoutDeals error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getFanbugPayouts = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const groupByStream = (matchStage) =>
      LiveStreamPayment.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$stream",
            creator: { $first: "$creator" },
            currency: { $first: "$currency" },
            totalAmount: { $sum: "$netAmount" },
            totalAmountInCents: { $sum: "$netAmountInCents" },
            // totalNetAmount: { $sum: "$netAmount" },
            // totalNetAmountInCents: { $sum: "$netAmountInCents" },
            paymentCount: { $sum: 1 },
            paymentIds: { $push: "$_id" },
            oldestPaymentAt: { $min: "$createdAt" },
            latestPaymentAt: { $max: "$createdAt" },
          },
        },
        {
          $lookup: {
            from: "live_streams",
            localField: "_id",
            foreignField: "_id",
            as: "streamInfo",
          },
        },
        { $unwind: { path: "$streamInfo", preserveNullAndEmptyArrays: true } },
        {
          $match: {
            "streamInfo.status": "ended",
          },
        },
        {
          $project: {
            _id: 0,
            stream: {
              _id: "$_id",
              title: { $ifNull: ["$streamInfo.title", "Deleted stream"] },
              roomName: { $ifNull: ["$streamInfo.roomName", null] },
              status: { $ifNull: ["$streamInfo.status", null] },
              endedAt: { $ifNull: ["$streamInfo.endedAt", null] },
            },
            creator: 1,
            currency: 1,
            totalAmount: 1,
            totalAmountInCents: 1,
            totalNetAmount: 1,
            totalNetAmountInCents: 1,
            paymentCount: 1,
            paymentIds: 1,
            oldestPaymentAt: 1,
            latestPaymentAt: 1,
          },
        },
        { $sort: { latestPaymentAt: -1 } },
      ]);

    const unpaidGroups = await groupByStream({
      creator: userId,
      isPayoutDone: false,
    });

    const pending = unpaidGroups.filter((g) => g.latestPaymentAt > oneWeekAgo);
    const active = unpaidGroups.filter((g) => g.latestPaymentAt <= oneWeekAgo);

    const history = await groupByStream({
      creator: userId,
      isPayoutDone: true,
    });

    return res.status(200).json({
      success: true,
      data: { pending, active, history },
    });
  } catch (error) {
    console.error("getFanbugPayouts error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const payoutFanbugStreams = async (req, res) => {
  try {
    const { streamIds } = req.body;

    if (!Array.isArray(streamIds) || !streamIds.length) {
      return res.status(400).json({
        success: false,
        message: "Stream ids are required",
      });
    }

    const payments = await LiveStreamPayment.find({
      stream: { $in: streamIds },
      isPayoutDone: false,
    }).populate("creator");

    if (!payments.length) {
      return res.status(404).json({
        success: false,
        message: "No eligible payments found for the selected streams",
      });
    }

    const creatorId = payments[0].creator._id.toString();

    const allBelongToSameCreator = payments.every(
      (payment) => payment.creator._id.toString() === creatorId,
    );

    if (!allBelongToSameCreator) {
      return res.status(400).json({
        success: false,
        message: "All selected streams must belong to the same creator",
      });
    }

    const creator = payments[0].creator;

    if (!creator?.stripeConnectAccountId) {
      return res.status(400).json({
        success: false,
        message: "Creator has not connected Stripe account",
      });
    }

    let totalPayoutCents = 0;
    const AdminSettings = require("../models/adminSettings");
    const settings = await AdminSettings.findOne();
    const percentage = Number(
      settings?.fanbugPayoutPercentage ?? settings?.dealsPayoutPercentage ?? 0,
    );

    const payoutBreakdown = payments.map((payment) => {
      const baseCents =
        Number(payment.netAmountInCents) > 0
          ? Number(payment.netAmountInCents)
          : Number(payment.amountInCents || 0);

      const deductionCents = Math.round((baseCents * percentage) / 100);
      const paidCents = baseCents - deductionCents;
      totalPayoutCents += paidCents;
      return {
        paymentId: payment._id,
        streamId: payment.stream,
        amount: payment.amount,
        stripeFeeInCents: payment.stripeFeeInCents || 0,
        netAmountInCents: baseCents,
        percentage,
        deductionAmount: deductionCents / 100,
        paidAmount: paidCents / 100,
      };
    });

    if (totalPayoutCents <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payout amount",
      });
    }

    const idempotencyKey = require("crypto")
      .createHash("sha256")
      .update([...streamIds].sort().join(","))
      .digest("hex");

    const transfer = await stripe.transfers.create(
      {
        amount: totalPayoutCents,
        currency: "usd",
        destination: creator.stripeConnectAccountId,
        metadata: {
          creatorId: creator._id.toString(),
          streamIds: streamIds.join(","),
        },
      },
      { idempotencyKey },
    );

    const payoutAt = new Date();

    const bulkOperations = payoutBreakdown.map((item) => ({
      updateOne: {
        filter: { _id: item.paymentId },
        update: {
          $set: {
            isPayoutDone: true,
            payoutAmount: item.paidAmount,
            payoutAt,
            transferId: transfer.id,
          },
        },
      },
    }));

    await LiveStreamPayment.bulkWrite(bulkOperations);

    return res.status(200).json({
      success: true,
      message: "Payout sent successfully",
      data: {
        transferId: transfer.id,
        totalPayoutAmount: totalPayoutCents / 100,
        streamCount: streamIds.length,
        paymentCount: payments.length,
        payoutBreakdown,
      },
    });
  } catch (error) {
    console.error("payoutFanbugStreams error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


const getFanSubscriptionPayouts = async (req, res) => {
  try {
    const creatorId = new mongoose.Types.ObjectId(req.user._id);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 3);

    const groupByFanAndMonth = (matchStage) =>
      FanPaymentHistory.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              fan: "$fanId",
              month: { $dateToString: { format: "%Y-%m", date: "$paidAt" } },
            },
            currency: { $first: "$currency" },
            totalAmount: { $sum: "$netAmount" },
            totalAmountInCents: { $sum: "$netAmountInCents" },
            paymentCount: { $sum: 1 },
            paymentIds: { $push: "$_id" },
            oldestPaidAt: { $min: "$paidAt" },
            latestPaidAt: { $max: "$paidAt" },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id.fan",
            foreignField: "_id",
            as: "fanInfo",
          },
        },
        { $unwind: { path: "$fanInfo", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            fan: {
              _id: "$_id.fan",
              firstName: { $ifNull: ["$fanInfo.firstName", null] },
              lastName: { $ifNull: ["$fanInfo.lastName", null] },
              username: { $ifNull: ["$fanInfo.username", null] },
              image: { $ifNull: ["$fanInfo.image", null] },
            },
            month: "$_id.month",
            currency: 1,
            totalAmount: 1,
            totalAmountInCents: 1,
            paymentCount: 1,
            paymentIds: 1,
            oldestPaidAt: 1,
            latestPaidAt: 1,
          },
        },
        { $sort: { latestPaidAt: -1 } },
      ]);

    const unpaidGroups = await groupByFanAndMonth({
      creatorId,
      status: "paid",
      isPayoutDone: false,
    });

    const pending = unpaidGroups.filter(
      (g) => g.latestPaidAt > thirtyDaysAgo,
    );
    const active = unpaidGroups.filter(
      (g) => g.latestPaidAt <= thirtyDaysAgo,
    );

    const history = await groupByFanAndMonth({
      creatorId,
      status: "paid",
      isPayoutDone: true,
    });

    return res.status(200).json({
      success: true,
      data: { pending, active, history },
    });
  } catch (error) {
    console.error("getFanSubscriptionPayouts error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const payoutFanSubscriptions = async (req, res) => {
  try {
    const { paymentIds } = req.body;

    if (!Array.isArray(paymentIds) || !paymentIds.length) {
      return res.status(400).json({
        success: false,
        message: "Payment ids are required",
      });
    }

    const payments = await FanPaymentHistory.find({
      _id: { $in: paymentIds },
      isPayoutDone: false,
      status: "paid",
    }).populate("creatorId");

    if (!payments.length) {
      return res.status(404).json({
        success: false,
        message: "No eligible payments found for payout",
      });
    }

    const creatorIdStr = payments[0].creatorId._id.toString();
    const allBelongToSameCreator = payments.every(
      (p) => p.creatorId._id.toString() === creatorIdStr,
    );
    if (!allBelongToSameCreator) {
      return res.status(400).json({
        success: false,
        message: "All selected payments must belong to the same creator",
      });
    }

    const creator = payments[0].creatorId;
    if (!creator?.stripeConnectAccountId) {
      return res.status(400).json({
        success: false,
        message: "Creator has not connected Stripe account",
      });
    }

    const AdminSettings = require("../models/adminSettings");
    const settings = await AdminSettings.findOne();
    const percentage = Number(
      settings?.fanSubscriptionPayoutPercentage ??
        0,
    );

    let totalPayoutCents = 0;
    const payoutBreakdown = payments.map((payment) => {
      const baseCents =
        Number(payment.netAmountInCents) > 0
          ? Number(payment.netAmountInCents)
          : Number(payment.amountInCents || 0);

      const deductionCents = Math.round((baseCents * percentage) / 100);
      const paidCents = baseCents - deductionCents;
      totalPayoutCents += paidCents;

      return {
        paymentId: payment._id,
        fanId: payment.fanId,
        amount: payment.amount,
        stripeFeeInCents: payment.stripeFeeInCents || 0,
        netAmountInCents: baseCents,
        percentage,
        deductionAmount: deductionCents / 100,
        paidAmount: paidCents / 100,
      };
    });

    if (totalPayoutCents <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payout amount",
      });
    }

    const idempotencyKey = require("crypto")
      .createHash("sha256")
      .update([...paymentIds].sort().join(","))
      .digest("hex");

    const transfer = await stripe.transfers.create(
      {
        amount: totalPayoutCents,
        currency: "usd",
        destination: creator.stripeConnectAccountId,
        metadata: {
          creatorId: creator._id.toString(),
          paymentIds: paymentIds.join(","),
        },
      },
      { idempotencyKey },
    );

    const payoutAt = new Date();
    const bulkOperations = payoutBreakdown.map((item) => ({
      updateOne: {
        filter: { _id: item.paymentId },
        update: {
          $set: {
            isPayoutDone: true,
            payoutAmount: item.paidAmount,
            payoutAt,
            transferId: transfer.id,
          },
        },
      },
    }));

    await FanPaymentHistory.bulkWrite(bulkOperations);

    return res.status(200).json({
      success: true,
      message: "Payout sent successfully",
      data: {
        transferId: transfer.id,
        totalPayoutAmount: totalPayoutCents / 100,
        paymentCount: payments.length,
        payoutBreakdown,
      },
    });
  } catch (error) {
    console.error("payoutFanSubscriptions error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  checkStripeOnboardingStatus,
  connectVendorStripe,
  getStripeOnboardingLink,
  getPayouts,
  payoutDeals,
  getFanbugPayouts,
  payoutFanbugStreams,
  getFanSubscriptionPayouts,
  payoutFanSubscriptions,
};
