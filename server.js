// const dns = require("dns");
// dns.setServers(["1.1.1.1"]);


const dotenv = require("dotenv");
const path = require("path");

// ENV configuration
const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";

dotenv.config({ path: path.resolve(__dirname, envFile) });

const mongoose = require("mongoose");
const app = require("./src/app");
const logger = require("./src/utils/logger");
const { Server } = require("socket.io");
const http = require("http");
const { initializeSocket } = require("./src/socket/socket");
const startScheduledPostCron = require("./src/jobs/publishScheduledPosts");
const startExpireBoostsCron = require("./src/jobs/expireBoosts");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: "*",
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
  }


  // app.listen(PORT, () => {
  //   logger.info(`Server running on port ${PORT}`);
  // });
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
};

startServer();
