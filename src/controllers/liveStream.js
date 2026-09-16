const Joi = require("joi");
const {
  AccessToken,
  RoomServiceClient,
} = require("livekit-server-sdk");
const LiveStream = require("../models/liveStream");
const LiveStreamComment = require("../models/liveStreamComment");
const Deal = require("../models/deal");
const { schemaValidator } = require("../utils/validator");

const PARTICIPANT_FIELDS = "_id firstName lastName username image";
const COMMENT_AUTHOR_FIELDS = "_id firstName lastName username image";

const createStreamSchema = Joi.object({
  title: Joi.string().trim().min(2).max(120).required(),
  category: Joi.string().trim().max(50).default("General"),
  streamType: Joi.string().valid("own", "collaborative").default("own"),
  dealId: Joi.when("streamType", {
    is: "collaborative",
    then: Joi.string().hex().length(24).required(),
    otherwise: Joi.forbidden(),
  }),
}).unknown(false);

const createCommentSchema = Joi.object({
  content: Joi.string().trim().min(1).max(300).required(),
}).unknown(false);

const getLiveKitConfig = () => {
  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!serverUrl || !apiKey || !apiSecret) {
    const error = new Error("LiveKit is not configured");
    error.statusCode = 503;
    throw error;
  }

  return { serverUrl, apiKey, apiSecret };
};

const getRoomService = () => {
  const { serverUrl, apiKey, apiSecret } = getLiveKitConfig();
  const httpUrl = serverUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");

  return new RoomServiceClient(httpUrl, apiKey, apiSecret);
};

const sendError = (res, error) =>
  res.status(error.statusCode || 500).json({
    status: "error",
    message: error.message || "Something went wrong",
  });

const createLiveStream = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    createStreamSchema,
  );
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    let deal = null;
    if (validatedData.streamType === "collaborative") {
      deal = await Deal.findById(validatedData.dealId);

      if (!deal) {
        return res
          .status(404)
          .json({ status: "error", message: "Deal not found" });
      }
      if (deal.receiver.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          status: "error",
          message: "Only the deal receiver can host this collaborative stream",
        });
      }
      if (deal.status !== "started") {
        return res.status(400).json({
          status: "error",
          message: `This deal is not currently active (status: ${deal.status})`,
        });
      }

      const streamDeliverable = deal.deliverables.find(
        (deliverable) => deliverable.type === "stream",
      );
      if (!streamDeliverable) {
        return res.status(400).json({
          status: "error",
          message: 'This deal has no "stream" deliverable',
        });
      }
      if (streamDeliverable.completed >= streamDeliverable.count) {
        return res.status(400).json({
          status: "error",
          message: "All stream deliverables for this deal are already fulfilled",
        });
      }
    }

    const existingStream = await LiveStream.findOne({
      creator: req.user._id,
      status: "live",
    });

    if (existingStream) {
      return res.status(409).json({
        status: "error",
        message: "You already have an active live stream",
        data: existingStream,
      });
    }

    const roomName = `stream_${req.user._id}_${Date.now()}`;
    const roomService = getRoomService();

    await roomService.createRoom({
      name: roomName,
      emptyTimeout: 10 * 60,
      maxParticipants: 500,
      metadata: JSON.stringify({
        creatorId: req.user._id.toString(),
        coHostId: deal?.sender?.toString() || null,
        streamType: validatedData.streamType,
        title: validatedData.title,
      }),
    });

    let stream;
    try {
      stream = await LiveStream.create({
        creator: req.user._id,
        streamType: validatedData.streamType,
        deal: deal?._id || null,
        coHost: deal?.sender || null,
        title: validatedData.title,
        category: validatedData.category,
        roomName,
        status: "live",
        startedAt: new Date(),
      });

      if (deal) {
        await deal.registerDeliverable("stream");
      }
    } catch (creationError) {
      if (stream?._id) {
        await LiveStream.findByIdAndDelete(stream._id);
      }
      try {
        await roomService.deleteRoom(roomName);
      } catch {
        // Preserve the original stream/deal error.
      }
      throw creationError;
    }

    await stream.populate([
      { path: "creator", select: PARTICIPANT_FIELDS },
      { path: "coHost", select: PARTICIPANT_FIELDS },
    ]);

    req.app.get("socketio")?.emit("livestream_created", stream);

    return res.status(201).json({
      status: "success",
      message: "Live stream created successfully",
      data: stream,
    });
  } catch (err) {
    return sendError(res, err);
  }
};

const listLiveStreams = async (_req, res) => {
  try {
    const streams = await LiveStream.find({ status: "live" })
      .populate("creator", PARTICIPANT_FIELDS)
      .populate("coHost", PARTICIPANT_FIELDS)
      .sort({ startedAt: -1 })
      .lean();

    return res.status(200).json({
      status: "success",
      data: streams,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const getLiveStream = async (req, res) => {
  try {
    const stream = await LiveStream.findById(req.params.streamId)
      .populate("creator", PARTICIPANT_FIELDS)
      .populate("coHost", PARTICIPANT_FIELDS)
      .lean();

    if (!stream) {
      return res
        .status(404)
        .json({ status: "error", message: "Live stream not found" });
    }

    return res.status(200).json({
      status: "success",
      data: stream,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const createJoinToken = async (req, res) => {
  try {
    const stream = await LiveStream.findById(req.params.streamId);
    if (!stream) {
      return res
        .status(404)
        .json({ status: "error", message: "Live stream not found" });
    }
    if (stream.status !== "live") {
      return res
        .status(410)
        .json({ status: "error", message: "This live stream has ended" });
    }

    const { serverUrl, apiKey, apiSecret } = getLiveKitConfig();
    const isCreator =
      stream.creator.toString() === req.user._id.toString();
    const isCoHost =
      stream.streamType === "collaborative" &&
      stream.coHost?.toString() === req.user._id.toString();
    const participantRole = isCreator
      ? "creator"
      : isCoHost
        ? "co-host"
        : "viewer";
    const displayName =
      [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") ||
      req.user.email;

    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: req.user._id.toString(),
      name: displayName,
      ttl: "2h",
      metadata: JSON.stringify({
        userId: req.user._id.toString(),
        role: participantRole,
      }),
    });

    accessToken.addGrant({
      roomJoin: true,
      room: stream.roomName,
      canPublish: isCreator || isCoHost,
      canSubscribe: true,
      canPublishData: false,
    });

    const token = await accessToken.toJwt();

    return res.status(200).json({
      status: "success",
      data: {
        token,
        serverUrl,
        role: participantRole,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const endLiveStream = async (req, res) => {
  try {
    const stream = await LiveStream.findOne({
      _id: req.params.streamId,
      creator: req.user._id,
    });

    if (!stream) {
      return res.status(404).json({
        status: "error",
        message: "Live stream not found or you are not its creator",
      });
    }

    if (stream.status === "ended") {
      return res.status(200).json({
        status: "success",
        message: "Live stream has already ended",
        data: stream,
      });
    }

    stream.status = "ended";
    stream.endedAt = new Date();
    await stream.save();

    try {
      await getRoomService().deleteRoom(stream.roomName);
    } catch (roomError) {
      console.error("Could not delete LiveKit room:", roomError.message);
    }

    const io = req.app.get("socketio");
    io?.to(`livestream_${stream._id}`).emit("livestream_ended", {
      streamId: stream._id,
    });
    io?.emit("livestream_removed", { streamId: stream._id });

    return res.status(200).json({
      status: "success",
      message: "Live stream ended successfully",
      data: stream,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const listLiveStreamComments = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [comments, total] = await Promise.all([
      LiveStreamComment.find({ stream: req.params.streamId })
        .populate("author", COMMENT_AUTHOR_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LiveStreamComment.countDocuments({ stream: req.params.streamId }),
    ]);

    return res.status(200).json({
      status: "success",
      data: comments.reverse(),
      pagination: {
        page,
        limit,
        total,
        hasNextPage: skip + comments.length < total,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const createLiveStreamComment = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    createCommentSchema,
  );
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const stream = await LiveStream.findOne({
      _id: req.params.streamId,
      status: "live",
    }).select("_id");

    if (!stream) {
      return res
        .status(404)
        .json({ status: "error", message: "Active live stream not found" });
    }

    const comment = await LiveStreamComment.create({
      stream: stream._id,
      author: req.user._id,
      content: validatedData.content,
    });
    await comment.populate("author", COMMENT_AUTHOR_FIELDS);

    req.app
      .get("socketio")
      ?.to(`livestream_${stream._id}`)
      .emit("livestream_comment", comment);

    return res.status(201).json({
      status: "success",
      message: "Comment posted successfully",
      data: comment,
    });
  } catch (err) {
    return sendError(res, err);
  }
};

module.exports = {
  createLiveStream,
  listLiveStreams,
  getLiveStream,
  createJoinToken,
  endLiveStream,
  listLiveStreamComments,
  createLiveStreamComment,
};
