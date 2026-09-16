const Message = require("../../models/message");
const Conversation = require("../../models/conversation");

const chatHandlers = (io, socket) => {
  socket.on("user_connected", ({ userId }) => {
    const room = `user_${userId}`;
    socket.join(room);
    console.info(`USER_CONNECTED: ${room}`);
  });

  socket.on("join_conversation_room", ({ conversationId }) => {
    socket.join(conversationId);
  });

  socket.on("send_message", async (params) => {
    const { conversationId, senderId, receiverId, message, attachment } =
      params;

    const payload = {
      conversationId,
      senderId,
      receiverId,
      message,
      attachment,
      ...(attachment && {
        attachment: {
          url: attachment?.url,
          type: attachment?.type,
          name: attachment?.name,
          size: attachment?.size,
        },
      }),
      timestamp: Date.now(),
    };

    try {
      const newMessage = new Message(payload);
      await newMessage.save();

      try {
        const conversation = await Conversation.findOne({ conversationId });

        if (conversation) {
          conversation.lastMessage = {
            // message: message || attachment?.name,
            message: message || attachment?.name,
            sender: senderId,
            createdAt: Date.now(),
          };
          conversation.lastUpdated = Date.now();
          conversation.messagesCount += 1;

          const currentUnreadCount =
            conversation.unreadMessagesCount.get(receiverId) || 0;
          conversation.unreadMessagesCount.set(
            receiverId,
            currentUnreadCount + 1,
          );

          await conversation.save();

          const conObj = {
            conversationId,
            lastMessage: {
              message: message || attachment?.name,
              sender: senderId,
              createdAt: Date.now(),
            },
            lastUpdated: Date.now(),
            unreadMessagesCount: Object.fromEntries(
              conversation.unreadMessagesCount,
            ),
          };
          io.to(`user_${receiverId}`).emit("update_conversation", conObj);
          io.to(`user_${senderId}`).emit("update_conversation", conObj);
        }
      } catch (error) {
        console.error("Error updating conversation:", error.message);
      }

      socket.broadcast.to(conversationId).emit("receive_message", newMessage);
    } catch (err) {
      console.error("Error saving message:", err.message);
    }
  });

  socket.on("reset_unread_count", async ({ conversationId, userId }) => {
    try {
      const conversation = await Conversation.findOne({ conversationId });

      if (conversation) {
        if (conversation.unreadMessagesCount.has(userId)) {
          conversation.unreadMessagesCount.set(userId, 0);
          await conversation.save();

          const conObj = {
            conversationId,
            unreadMessagesCount: Object.fromEntries(
              conversation.unreadMessagesCount,
            ),
          };

          io.to(`user_${userId}`).emit("reset_unread_messages_count", conObj);
        }
      }
    } catch (error) {
      console.error("Error resetting unread count:", error.message);
    }
  });

  socket.on("mark_all_read", async ({ userId }) => {
    try {
      const conversations = await Conversation.find({
        participants: userId,
      });

      for (const conversation of conversations) {
        const currentUnread = conversation.unreadMessagesCount.get(userId) || 0;

        if (currentUnread > 0) {
          // await Message.updateMany(
          //   {
          //     conversationId: conversation.conversationId,
          //     receiverId: userId,
          //     isRead: { $ne: true },
          //   },
          //   { $set: { isRead: true, readAt: Date.now() } },
          // );

          conversation.unreadMessagesCount.set(userId, 0);
          await conversation.save();

          const conObj = {
            conversationId: conversation.conversationId,
            unreadMessagesCount: Object.fromEntries(
              conversation.unreadMessagesCount,
            ),
          };

          io.to(`user_${userId}`).emit("reset_unread_messages_count", conObj);

          // io.to(conversation.conversationId).emit("messages_read", {
          //   conversationId: conversation.conversationId,
          //   readBy: userId,
          //   readAt: Date.now(),
          // });
        }
      }
    } catch (error) {
      console.error("Error resetting unread counts:", error.message);
    }
  });

  socket.on("typing", ({ conversationId, senderId }) => {
    socket.broadcast.to(conversationId).emit("user_typing", { senderId });
  });

  socket.on("stop_typing", ({ conversationId, senderId }) => {
    socket.broadcast.to(conversationId).emit("user_stop_typing", { senderId });
  });
};

module.exports = chatHandlers;
