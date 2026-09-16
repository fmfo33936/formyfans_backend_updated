const {
  createCommentOnTarget,
  deleteCommentOnTarget,
  listComments,
} = require("../utils/engagementHelper");

const createComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const comment = await createCommentOnTarget({
      targetType: "post",
      targetId: postId,
      content: req.body.content,
      mentions: req.body.mentions,
      user: req.user,
      req,
    });

    return res.status(201).json({
      status: "success",
      message: "Comment created successfully",
      comment,
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ message: error.message });
  }
};

const deleteComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const result = await deleteCommentOnTarget({
      targetType: "post",
      targetId: postId,
      commentId,
      user: req.user,
      req,
    });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ message: error.message });
  }
};

const getPostComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const { comments, pagination } = await listComments({
      targetType: "post",
      targetId: postId,
      req,
    });

    return res.status(200).json({
      message: "Comments fetched successfully",
      comments,
      pagination,
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ message: error.message });
  }
};

module.exports = {
  createComment,
  deleteComment,
  getPostComments,
};
