// utils/notificationHelper.js
const Notification = require("../models/notification");

const createNotification = async ({
  recipientId,
  senderId,
  type,
  targetType = null,
  targetId = null,
  title = "",
  message = "",
  meta = {},
}) => {
  if (!recipientId || String(recipientId) === String(senderId)) return;

  try {
    return await Notification.create({
      recipientId,
      senderId,
      type,
      targetType,
      targetId,
      title,
      message,
      meta,
    });
  } catch (error) {
    if (error.code === 11000) return null;
    console.error("Notification error:", error.message);
  }
};

module.exports = { createNotification };