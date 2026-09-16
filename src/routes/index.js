const express = require("express");
const router = express.Router();

const authRoutes = require("./user");
const subscriptionPlanRoutes = require("./subscriptionPlan");
const subscriptionRoutes = require("./subscription");
const productRoutes = require("./product");
const cartRoutes = require("./cart");
const orderRoutes = require("./order");
const adminRoutes = require("./admin");
const postRoutes = require("./post");
const storyRoutes = require("./story");
const followRoutes = require("./follow");
const feedRoutes = require("./feed");
const conversationRoutes = require("./conversation");
const messageRoutes = require("./message");
const mediaRoutes = require("./media");
const activityLogRoutes = require("./activityLog");
const favouriteRoutes = require("./favourite");
const likeRoutes = require("./like");
const notificationRoutes = require("./notification");
const exclusiveContentRoutes = require("./exclusiveContent");
const fanSubscriptionRoutes = require("./fanSubscription");
const campaignObjectiveRoutes = require("./campaignObjective");
const campaignCategoryRoutes = require("./campaignCategory");
const campaignRoutes = require("./campaign");
const dealRoutes = require("./deal");
const cardRoutes = require("./card");
const liveStreamRoutes = require("./liveStream");
const payoutRoutes = require("./payout");
const adminSettingsRoutes = require("./adminSettings");
const boostRoutes = require("./boost");

//model 

const Auth = require("../models/auth");

router.use("/auth", authRoutes);
router.use("/subscription-plans", subscriptionPlanRoutes);
router.use("/subscription", subscriptionRoutes);
router.use("/products", productRoutes);
router.use("/cart", cartRoutes);
router.use("/orders", orderRoutes);
router.use("/admin", adminRoutes);
router.use("/posts", postRoutes);
router.use("/exclusive-content", exclusiveContentRoutes);
router.use("/stories", storyRoutes);
router.use("/follow", followRoutes);
router.use("/feed", feedRoutes);
router.use("/conversations", conversationRoutes);
router.use("/messages", messageRoutes);
router.use("/media", mediaRoutes);
router.use("/activity-logs", activityLogRoutes);
router.use("/favourites", favouriteRoutes);
router.use("/likes", likeRoutes);
router.use("/notifications", notificationRoutes);
router.use("/fan/subscribe", fanSubscriptionRoutes);
router.use("/campaign-objectives", campaignObjectiveRoutes);
router.use("/campaign-categories", campaignCategoryRoutes);
router.use("/campaigns", campaignRoutes);
router.use("/deal", dealRoutes);
router.use("/cards", cardRoutes);
router.use("/live-streams", liveStreamRoutes);
router.use("/payouts", payoutRoutes);
router.use("/admin-settings", adminSettingsRoutes);
router.use("/boost", boostRoutes);

module.exports = router;
