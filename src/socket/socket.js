// Import all socket event handlers
const chatHandlers = require("./handlers/chatHandlers.js");
const liveStreamHandlers = require("./handlers/liveStreamHandlers.js");

let ioInstance = null;

const initializeSocket = (io) => {
  ioInstance = io;

  // Handle new connections
  io.on("connection", (socket) => {
    console.info("New connection:", socket.id);

    // Support explicit user registration
    socket.on("user_connected", ({ userId }) => {
      if (userId) {
        socket.join(`user_${userId}`);
        socket.join(`user:${userId}`);
        console.info(`USER_CONNECTED: user_${userId}`);
      }
    });

    // Also support joining room via handshake query
    if (socket.handshake?.query?.userId) {
      const uId = socket.handshake.query.userId;
      socket.join(`user_${uId}`);
      socket.join(`user:${uId}`);
    }

    // Register chat handlers
    chatHandlers(io, socket);

    // Register livestream handlers
    liveStreamHandlers(io, socket);

    // Handle disconnection
    socket.on("disconnect", () => {
      console.info("User disconnected:", socket.id);
    });
  });
};

const getIO = () => ioInstance;

/**
 * Emits real-time event directly to a specific user's socket room.
 */
const emitToUser = (userId, event, data) => {
  if (!ioInstance || !userId) return false;
  const uid = userId.toString();
  ioInstance.to(`user_${uid}`).to(`user:${uid}`).emit(event, data);
  return true;
};

module.exports = {
  initializeSocket,
  getIO,
  emitToUser,
};
