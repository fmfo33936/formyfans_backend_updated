const { createRedisConnection } = require("../config/redis");
const logger = require("../utils/logger");

let redis;
const getRedis = () => {
  if (!redis) redis = createRedisConnection("ai-rate-limit");
  return redis;
};

const createAiRateLimit = ({ name, limit, windowSeconds }) => async (req, res, next) => {
  try {
    const identity = req.user?._id?.toString() || req.ip;
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `rate:ai:${name}:${identity}:${bucket}`;
    const count = await getRedis().incr(key);
    if (count === 1) await getRedis().expire(key, windowSeconds + 1);

    if (count > limit) {
      return res.status(429).json({
        success: false,
        message: "You're creating too quickly. Please wait a moment and try again.",
      });
    }
    return next();
  } catch (error) {
    logger.error(`[AI Rate Limit] ${error.message}`);
    return res.status(503).json({
      success: false,
      message: "The creation service is getting ready. Please try again shortly.",
    });
  }
};

module.exports = {
  promptRateLimit: createAiRateLimit({ name: "prompt", limit: 20, windowSeconds: 60 }),
  generationRateLimit: createAiRateLimit({ name: "generation", limit: 10, windowSeconds: 60 }),
  uploadRateLimit: createAiRateLimit({ name: "upload", limit: 30, windowSeconds: 60 }),
  creditPaymentRateLimit: createAiRateLimit({ name: "credit-payment", limit: 10, windowSeconds: 60 }),
};
