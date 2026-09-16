const express = require("express");
const {
    checkStripeOnboardingStatus,
    connectVendorStripe,
    getStripeOnboardingLink,
    getPayouts,
    payoutDeals,
    getFanbugPayouts,
    payoutFanbugStreams,
    getFanSubscriptionPayouts,
    payoutFanSubscriptions
} = require("../controllers/payout");
const { verifyUser } = require("../middlewares/auth");
const router = express.Router();


router.get("/onboarding-status", verifyUser, checkStripeOnboardingStatus);
router.get("/connect-stripe", verifyUser, connectVendorStripe);
router.get("/onboarding-link", verifyUser, getStripeOnboardingLink);
router.get("/payouts", verifyUser, getPayouts);
router.post("/redeem-amount", verifyUser, payoutDeals);
router.get("/fanbug-payouts", verifyUser, getFanbugPayouts);
router.post("/fanbug-streams", verifyUser, payoutFanbugStreams);
router.get("/fan-subscription-payouts", verifyUser, getFanSubscriptionPayouts);
router.post("/fan-subscriptions", verifyUser, payoutFanSubscriptions);


module.exports = router;
