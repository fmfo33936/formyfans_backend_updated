const express = require("express");
const router = express.Router();
const {
  initiateCreatorSubscription,
  confirmCreatorSubscription,
  cancelCreatorSubscription,
  resumeCreatorSubscription,
  getCreatorSubscriptionStatus,
} = require("../controllers/fanSubscription");
const { verifyUser } = require("../middlewares/auth");

router.post("/initiate/:username", verifyUser, initiateCreatorSubscription);
router.post("/confirm/:username", verifyUser, confirmCreatorSubscription);
router.post("/cancel/:username", verifyUser, cancelCreatorSubscription);
router.post("/resume/:username", verifyUser, resumeCreatorSubscription);
router.get("/status/:username", verifyUser, getCreatorSubscriptionStatus);

module.exports = router;
