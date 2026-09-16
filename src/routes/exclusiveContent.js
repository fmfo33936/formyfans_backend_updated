const express = require("express");
const router = express.Router();
const {
  createComment,
  deleteComment,
  getPostComments,
} = require("../controllers/comment");
const { likePost, unlikePost, getPostLikes } = require("../controllers/like");
const { verifyUser, optionalVerifyUser } = require("../middlewares/auth");
const { sharePost } = require("../controllers/share");
const {
  createExclusiveContent,
  getAllExclusiveContent,
  getUserExclusiveContentByUsername,
  getExclusiveContentById,
  updateExclusiveContent,
  deleteExclusiveContent,
} = require("../controllers/exclusiveContent");

// Post Crud
router.post("/", verifyUser, createExclusiveContent);
router.get("/", optionalVerifyUser, getAllExclusiveContent);
router.get(
  "/username/:username",
  optionalVerifyUser,
  getUserExclusiveContentByUsername,
);
router.get("/:id", verifyUser, getExclusiveContentById);
router.put("/:id", verifyUser, updateExclusiveContent);
router.delete("/:id", verifyUser, deleteExclusiveContent);

// Comment Crud
router.post("/:postId/comments", verifyUser, createComment);
router.get("/:postId/comments", verifyUser, getPostComments);
router.delete("/:postId/comments/:commentId", verifyUser, deleteComment);

// Like Crud
router.post("/:postId/like", verifyUser, likePost);
router.delete("/:postId/unlike", verifyUser, unlikePost);
router.get("/:postId/likes", verifyUser, getPostLikes);

// Share Crud
router.post("/share", verifyUser, sharePost);

module.exports = router;
