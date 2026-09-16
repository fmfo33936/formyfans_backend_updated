const express = require("express");
const router = express.Router();
const {
  resetPassword,
  sendOTP,
  createUser,
  loginUser,
  forgotPassword,
  verifyOtp,
  changePassword,
  updateProfile,
  getProfile,
  checkUsernameAvailability,
  suggestUsername,
  getAllCreators,
  getProfileByUsername,
  stripeCreateClientSecret,
  loginByUsername,
  updateProfileUsername,
  loginCreator,
  sendWelcomeEmail,
  createCreator,
} = require("../controllers/auth");
const { verifyUser } = require("../middlewares/auth");
const {
  setCreatorSubscriptionPrice,
  getCreatorSubscriptionPrice,
  getFanSubsribedOrNot,
} = require("../controllers/creatorSubscription");
const { getReviewsByCreatorId } = require("../controllers/review");
const { verifyAdmin } = require("../middlewares/admin");  

router.post("/send-otp", sendOTP);
router.post("/create-user", createUser);
router.post("/login-user", loginUser);
router.post("/login-creator", loginCreator);
router.post("/forgot-password", forgotPassword);
router.post("/verify-otp", verifyOtp);
router.post("/reset-password", resetPassword);
router.put("/change-password", verifyUser, changePassword);
router.put("/profile", verifyUser, updateProfile);
router.get("/profile", verifyUser, getProfile);
router.get("/profile/:username", verifyUser, getProfileByUsername);
router.patch("/profile/username", verifyUser, updateProfileUsername);

router.post("/check-username-availability", checkUsernameAvailability);
router.post("/suggest-username", suggestUsername);

// Updated routes
router.get("/creators", verifyUser, getAllCreators);
router.get("/creator/:creatorId/reviews", verifyUser, getReviewsByCreatorId);

// Stripe routes
router.post("/subscription/create-client-secret", stripeCreateClientSecret);

// Login by username
// router.post("/login-by-username", loginByUsername);

// Set Subscription price by creator
router.post("/set-subscription-price", verifyUser, setCreatorSubscriptionPrice);
router.get("/creator/price", verifyUser, getCreatorSubscriptionPrice);
router.get("/fan/subscribe/:username", verifyUser, getFanSubsribedOrNot);

// Send Welcome email
router.post("/send-welcome", sendWelcomeEmail);

router.post("/creators", createCreator);

module.exports = router;
