const FollowSuggestionDismissModel = require("../models/followSuggestionDismiss");
const FollowModel = require("../models/follow");
const UserModel = require("../models/auth");
const { dismissFollowSuggestionSchema } = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");

const dismissFollowSuggestion = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    dismissFollowSuggestionSchema,
  );
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const { dismissedUserId } = validatedData;
    const loggedInUser = req.user;

    if (loggedInUser._id.toString() === dismissedUserId.toString()) {
      return res
        .status(400)
        .json({ status: "error", message: "You cannot dismiss yourself" });
    }

    const dismissedUser = await UserModel.exists({ _id: dismissedUserId });
    if (!dismissedUser) {
      return res
        .status(404)
        .json({ status: "error", message: "Dismissed user not found" });
    }

    const isFollower = await FollowModel.exists({
      followerId: dismissedUserId,
      followingId: loggedInUser._id,
    });
    if (!isFollower) {
      return res
        .status(400)
        .json({ status: "error", message: "User is not your follower" });
    }

    const followSuggestionDismiss = await FollowSuggestionDismissModel.create({
      userId: loggedInUser._id,
      dismissedUserId,
    });
    return res.status(200).json({
      status: "success",
      message: "Follow suggestion dismissed successfully",
      followSuggestionDismiss,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        status: "error",
        message: "Follow suggestion already dismissed",
      });
    }
    return res.status(500).json({ status: "error", message: error.message });
  }
};

module.exports = {
  dismissFollowSuggestion,
};
