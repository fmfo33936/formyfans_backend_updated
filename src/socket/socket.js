// Import all socket event handlers
const chatHandlers = require("./handlers/chatHandlers.js");
const liveStreamHandlers = require("./handlers/liveStreamHandlers.js");
const jwt = require("jsonwebtoken");
const User = require("../models/auth");
const logger = require("../utils/logger");

let ioInstance = null;

const initializeSocket = (io) => {
  ioInstance = io;

  // 1. Socket.IO Authentication Middleware (Validates Authorization header)
  io.use(async (socket, next) => {
    try {
      const authHeader =
        socket.handshake.headers?.authorization ||
        socket.handshake.headers?.Authorization;

      const rawToken =
        authHeader ||
        socket.handshake.auth?.token ||
        socket.handshake.query?.token;

      if (rawToken) {
        const cleanToken = rawToken.replace(/^Bearer\s+/i, "").trim();
        const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
        const userId = decoded.id || decoded._id || decoded.userId;

        if (!userId) {
          return next(new Error("Authentication error: Invalid token payload"));
        }

        const user = await User.findById(userId).select("_id email role status isVerified");
        if (!user) {
          return next(new Error("Authentication error: User not found"));
        }

        if (user.status === "inactive") {
          return next(new Error("Authentication error: Account is deactivated"));
        }

        socket.user = user;
        socket.userId = user._id.toString();
        logger.info(`[Socket.IO Auth] Authenticated user ${socket.userId} (${user.email}) via Authorization header.`);
        return next();
      }

      // Fallback for development if userId query parameter is passed
      const directUserId = socket.handshake.query?.userId || socket.handshake.auth?.userId;
      if (directUserId) {
        socket.userId = directUserId.toString().trim();
        logger.info(`[Socket.IO Auth] Connected with direct userId parameter: ${socket.userId}`);
        return next();
      }

      // If no token and no userId provided
      logger.warn(`[Socket.IO Auth] Connection rejected for socket ${socket.id}: No Authorization header provided.`);
      return next(new Error("Authentication error: Authorization header (Bearer <token>) is required to connect."));
    } catch (err) {
      logger.error(`[Socket.IO Auth] Verification failed: ${err.message}`);
      return next(new Error(`Authentication error: ${err.message}`));
    }
  });

  // 2. Handle Connected Sockets
  io.on("connection", (socket) => {
    logger.info(`[Socket.IO] New connection established: ${socket.id}`);

    const joinUserRooms = (uId) => {
      if (!uId) return;
      const cleanId = uId.toString().trim();
      socket.join(`user_${cleanId}`);
      socket.join(`user:${cleanId}`);
      socket.join(cleanId);
      socket.userId = cleanId;
      logger.info(`[Socket.IO] Socket ${socket.id} joined rooms: 'user_${cleanId}', '${cleanId}'`);
    };

    // Auto-join rooms for authenticated user
    if (socket.userId) {
      joinUserRooms(socket.userId);
      socket.emit("authenticated", {
        success: true,
        userId: socket.userId,
        email: socket.user?.email || null,
        message: `Socket authenticated successfully! Listening for AI events on room user_${socket.userId}`,
      });
    }

    // Support explicit user_connected event from client
    socket.on("user_connected", ({ userId }) => {
      if (userId) {
        joinUserRooms(userId);
        socket.emit("connected_ack", {
          success: true,
          userId,
          message: `Connected and listening to events for user_${userId}`,
        });
      }
    });

    // Register chat handlers
    chatHandlers(io, socket);

    // Register livestream handlers
    liveStreamHandlers(io, socket);

    // Handle disconnection
    socket.on("disconnect", () => {
      logger.info(`[Socket.IO] User disconnected: ${socket.id} (userId: ${socket.userId || "anonymous"})`);
    });
  });
};

const getIO = () => ioInstance;

/**
 * Emits real-time event directly to a specific user's socket room.
 * Also broadcasts in development so Postman test tabs always receive events.
 */
const emitToUser = (userId, event, data) => {
  try {
    if (!ioInstance) {
      logger.warn(`[Socket.IO] emitToUser called before socket server was initialized.`);
      return false;
    }

    const uid = userId ? userId.toString().trim() : null;

    if (uid) {
      const room1 = `user_${uid}`;
      const room2 = `user:${uid}`;
      const room3 = uid;

      const socketsInRoom = ioInstance.sockets.adapter.rooms.get(room1)?.size || 0;
      logger.info(`[Socket.IO] Emitting '${event}' to user '${uid}'. Active clients in '${room1}': ${socketsInRoom}`);

      if (socketsInRoom === 0) {
        logger.warn(`[Socket.IO] Notice: No active socket client connected in room '${room1}' for user '${uid}'.`);
      }

      // Emit to user private rooms
      ioInstance.to(room1).to(room2).to(room3).emit(event, data);
    }

    // In development mode: also broadcast to all active sockets for seamless Postman testing
    if (process.env.NODE_ENV !== "production") {
      ioInstance.emit(event, { ...data, targetUserId: uid });
      logger.info(`[Socket.IO Dev] Broadcasted '${event}' to all active clients (targetUserId: ${uid}).`);
    }

    return true;
  } catch (err) {
    logger.error(`[Socket.IO] Error emitting '${event}' to user ${userId}: ${err.message}`);
    return false;
  }
};

module.exports = {
  initializeSocket,
  getIO,
  emitToUser,
};
