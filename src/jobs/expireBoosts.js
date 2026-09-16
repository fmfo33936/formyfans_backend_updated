// jobs/expireBoosts.js
const cron = require("node-cron");
const logger = require("../utils/logger");
const { expireDueBoosts } = require("../utils/boostLifecycle");

const expireBoosts = async () => {
  try {
    const completed = await expireDueBoosts();
    if (completed > 0) {
      logger.info(`Marked ${completed} boost(s) as completed`);
    }
  } catch (error) {
    logger.error(`Error expiring boosts: ${error.message}`);
  }
};

const startExpireBoostsCron = () => {
  cron.schedule("* * * * *", expireBoosts);
  logger.info("Boost expiry cron started");
};

module.exports = startExpireBoostsCron;