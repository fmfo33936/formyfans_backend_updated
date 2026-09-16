const streamViewers = new Map();

const getViewerCount = (streamId) => streamViewers.get(streamId)?.size || 0;

const emitViewerCount = (io, streamId) => {
  io.to(`livestream_${streamId}`).emit("livestream_viewer_count", {
    streamId,
    viewerCount: getViewerCount(streamId),
  });
};

const removeViewer = (io, socket, streamId) => {
  const viewers = streamViewers.get(streamId);
  if (!viewers) return;

  viewers.delete(socket.id);
  if (viewers.size === 0) {
    streamViewers.delete(streamId);
  }
  emitViewerCount(io, streamId);
};

const liveStreamHandlers = (io, socket) => {
  socket.on("join_livestream", ({ streamId } = {}) => {
    if (!streamId) return;

    const normalizedStreamId = streamId.toString();
    const roomName = `livestream_${normalizedStreamId}`;
    socket.join(roomName);
    socket.data.liveStreamId = normalizedStreamId;

    if (!streamViewers.has(normalizedStreamId)) {
      streamViewers.set(normalizedStreamId, new Set());
    }
    streamViewers.get(normalizedStreamId).add(socket.id);
    emitViewerCount(io, normalizedStreamId);
  });

  socket.on("leave_livestream", ({ streamId } = {}) => {
    const normalizedStreamId = streamId?.toString() || socket.data.liveStreamId;
    if (!normalizedStreamId) return;

    socket.leave(`livestream_${normalizedStreamId}`);
    removeViewer(io, socket, normalizedStreamId);
    delete socket.data.liveStreamId;
  });

  socket.on(
    "livestream_pip_move",
    ({ streamId, participantId, xPct, yPct } = {}) => {
      if (!streamId || !participantId) return;

      const normalizedStreamId = streamId.toString();
      socket
        .to(`livestream_${normalizedStreamId}`)
        .emit("livestream_pip_move", {
          streamId: normalizedStreamId,
          participantId,
          xPct,
          yPct,
        });
    },
  );

  socket.on(
    "livestream_pip_resize",
    ({ streamId, participantId, widthPct, heightPct } = {}) => {
      if (!streamId || !participantId) return;

      const normalizedStreamId = streamId.toString();
      socket
        .to(`livestream_${normalizedStreamId}`)
        .emit("livestream_pip_resize", {
          streamId: normalizedStreamId,
          participantId,
          widthPct,
          heightPct,
        });
    },
  );

  socket.on("disconnect", () => {
    if (socket.data.liveStreamId) {
      removeViewer(io, socket, socket.data.liveStreamId);
    }
  });
};

module.exports = liveStreamHandlers;
