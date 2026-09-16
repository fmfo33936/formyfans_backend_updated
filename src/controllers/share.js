const { shareTarget } = require("../utils/engagementHelper");
const { sharePostSchema } = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");

const sharePost = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, sharePostSchema);
  if (error) return res.status(400).json({ status: "error", message: error });

  try {
    const { postId, recipientIds } = validatedData;
    const result = await shareTarget({
      targetType: "post",
      targetId: postId,
      recipientIds,
      user: req.user,
      req,
      io: req.app.get("socketio"),
    });

    return res.status(200).json({
      status: "success",
      ...result,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: "error",
      message: error.message,
    });
  }
};

module.exports = { sharePost };
