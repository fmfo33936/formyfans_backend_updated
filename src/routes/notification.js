const express = require("express");
const {
  getNotifications,
  getNotificationsCount,
  markAllRead,
} = require("../controllers/notification");
const { verifyUser } = require("../middlewares/auth");

const router = express.Router();

router.get("/", verifyUser, getNotifications);
router.get("/count", verifyUser, getNotificationsCount);
router.patch("/mark-all-read", verifyUser, markAllRead);

module.exports = router;
