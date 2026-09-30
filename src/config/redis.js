const IORedis = require("ioredis");
const logger = require("../utils/logger");

const createRedisConnection = (name, { blocking = false } = {}) => {
  const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: blocking ? null : 1,
    enableReadyCheck: true,
    connectTimeout: 5000,
    connectionName: `formyfans-${name}`,
  });

  connection.on("error", (error) => logger.error(`[Redis:${name}] ${error.message}`));
  return connection;
};

module.exports = { createRedisConnection };
