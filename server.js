// const dns = require("dns");
// dns.setServers(["1.1.1.1"]);


const fs = require("fs");
const dotenv = require("dotenv");
const path = require("path");

// ENV configuration
const requestedEnvFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";

const requestedEnvPath = path.resolve(__dirname, requestedEnvFile);
const devEnvPath = path.resolve(__dirname, ".env.development");
const defaultEnvPath = path.resolve(__dirname, ".env");

if (fs.existsSync(requestedEnvPath)) {
  dotenv.config({ path: requestedEnvPath });
} else if (fs.existsSync(devEnvPath)) {
  dotenv.config({ path: devEnvPath });
} else if (fs.existsSync(defaultEnvPath)) {
  dotenv.config({ path: defaultEnvPath });
} else {
  dotenv.config();
}

const mongoose = require("mongoose");
const app = require("./src/app");
const logger = require("./src/utils/logger");
const { Server } = require("socket.io");
const http = require("http");
const { initializeSocket } = require("./src/socket/socket");
const startScheduledPostCron = require("./src/jobs/publishScheduledPosts");
const startExpireBoostsCron = require("./src/jobs/expireBoosts");
const aiJobQueue = require("./src/services/queue/aiJobQueue");
const { configuredOrigins } = require("./src/config/cors");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: configuredOrigins,
      methods: ["GET", "POST", "OPTIONS"],
      credentials: true,
    },
  });

  initializeSocket(io);

  app.set("socketio", io);

  if (!mongoUri) {
    logger.warn("Mongo URI is not set. Skipping database connection.");
  } else {
    try {
      await mongoose.connect(mongoUri);
      logger.info("MongoDB connected successfully.");
      startScheduledPostCron();
      startExpireBoostsCron();
    } catch (error) {
      logger.error(`MongoDB connection failed: ${error.message}`);
    }

    if (mongoose.connection.readyState === 1) {
      try {
        await aiJobQueue.recoverOnStartup();
      } catch (error) {
        logger.error(`AI queue startup failed: ${error.message}`);
      }
    }
  }


  // app.listen(PORT, () => {
  //   logger.info(`Server running on port ${PORT}`);
  // });
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received. Closing AI worker and server.`);
    server.close();
    await aiJobQueue.close();
    await mongoose.connection.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
};

startServer();
