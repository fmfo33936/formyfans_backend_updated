const express = require("express");
const router = express.Router();
const { verifyUser } = require("../middlewares/auth");
const {
    buySubscription,
    createSubscription,
    cancelSubscription,
    resumeSubscription,
    getCurrentSubscription,
    getPaymentHistory,
    initiateSubscriptionSetup,
    confirmSubscriptionSetup,
    createSubscriptionForInternalUsers
} = require("../controllers/subscription");

router.post("/buy", verifyUser, buySubscription);

router.post("/create", verifyUser, createSubscription);

router.post("/initiate-setup", verifyUser, initiateSubscriptionSetup);
router.post("/confirm-setup", verifyUser, confirmSubscriptionSetup);

// router.post("/upgrade-downgrade", protect, switchPlan);

router.post("/cancel", verifyUser, cancelSubscription);
router.post("/resume", verifyUser, resumeSubscription);
router.get("/current", verifyUser, getCurrentSubscription);
router.get("/history", verifyUser, getPaymentHistory);

// This is for internal users which is valid till 2049
router.post("/create-internal", verifyUser, createSubscriptionForInternalUsers);

module.exports = router;
