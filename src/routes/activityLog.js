const express = require("express");
const router = express.Router();
const { getUserActivityLogs } = require("../controllers/activityLog");
const { verifyUser } = require("../middlewares/auth");

router.get("/", verifyUser, getUserActivityLogs);

module.exports = router;