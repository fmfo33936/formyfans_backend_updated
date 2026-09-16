// middleware/checkCreatorSubscription.js
const FanSubscriptionModel = require("../models/fanSubscription");

const checkCreatorSubscription = async (req, res, next) => {
  try {
    const fanId = req.user._id;
    const creatorId = req.params.creatorId;

    const activeSub = await FanSubscriptionModel.findOne({
      fanId,
      creatorId,
      status: "active",
      cancelAtPeriodEnd: false,
    });

    const canceledButStillActive = await FanSubscriptionModel.findOne({
      fanId,
      creatorId,
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { $gt: new Date() },
    });

    if (!activeSub && !canceledButStillActive) {
      return res.status(403).json({
        message: "Subscribe to this creator to view exclusive content",
        isSubscribed: false,
      });
    }

    req.fanSubscription = activeSub || canceledButStillActive;
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = checkCreatorSubscription;
