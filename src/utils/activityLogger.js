// utils/activityLogger.js
const ActivityLog = require("../models/activityLog");

const logActivity = async (
  req,
  { userId, action, targetType = null, targetId = null, meta = {} },
) => {
  try {
    await ActivityLog.create({
      userId,
      action,
      targetType,
      targetId,
      meta,
      ipAddress: req?.ip || "system",
      userAgent: req?.headers?.["user-agent"] || "system-cron",
    });
  } catch (error) {
    console.error("Activity log error:", error.message);
  }
};

module.exports = { logActivity };
