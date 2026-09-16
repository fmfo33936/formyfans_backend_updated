const {
  likeTarget,
  unlikeTarget,
  listLikes,
} = require("../utils/engagementHelper");
const { likePostSchema } = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");

const likePost = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, likePostSchema);
  if (error) return res.status(400).json({ status: "error", message: error });

  try {
    const result = await likeTarget({
      targetType: "post",
      targetId: validatedData.postId,
      user: req.user,
      req,
    });
    return res.status(201).json({ status: "success", ...result });
  } catch (error) {
    if (error.code === 11000 || error.statusCode === 400) {
      return res
        .status(400)
        .json({ status: "error", message: error.message || "Already liked" });
    }
    return res.status(error.statusCode || 500).json({
      status: "error",
      message: error.message,
    });
  }
};

const unlikePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const result = await unlikeTarget({
      targetType: "post",
      targetId: postId,
      user: req.user,
      req,
    });
    return res.status(200).json({ status: "success", ...result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: "error",
      message: error.message,
    });
  }
};

const getPostLikes = async (req, res) => {
  try {
    const { postId } = req.params;
    const { data, pagination } = await listLikes({
      targetType: "post",
      targetId: postId,
      req,
    });
    return res.status(200).json({
      status: "success",
      message: "Likes fetched successfully",
      data,
      pagination,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

module.exports = { likePost, unlikePost, getPostLikes };
