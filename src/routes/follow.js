const express = require("express");
const router = express.Router();
const {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  isFollowingUser,
  getFollowersSuggestions,
} = require("../controllers/follow");
const { verifyUser } = require("../middlewares/auth");
const { dismissFollowSuggestion } = require("../controllers/followSuggestionDismiss");

router.post("/", verifyUser, followUser);
router.delete("/:userId", verifyUser, unfollowUser);
router.get("/:userId/is-following", verifyUser, isFollowingUser);

router.get("/followers", verifyUser, getFollowers);
router.get("/following", verifyUser, getFollowing);
router.get("/followers/suggestions", verifyUser, getFollowersSuggestions);
router.post("/followers/suggestions/dismiss", verifyUser, dismissFollowSuggestion);


module.exports = router;
