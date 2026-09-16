const express = require("express");
const router = express.Router();
const {
  createStory,
  getActiveStories,
  getActiveStoriesByUser,
} = require("../controllers/story");
const { verifyUser } = require("../middlewares/auth");

router.post("/", verifyUser, createStory);
router.get("/active", verifyUser, getActiveStories);
router.get("/user/:userId", verifyUser, getActiveStoriesByUser);

module.exports = router;
