const express = require("express");
const router = express.Router();
const { getFollowingFeed } = require("../controllers/feed");
const { verifyUser } = require("../middlewares/auth");

router.get("/following", verifyUser, getFollowingFeed);

module.exports = router;
