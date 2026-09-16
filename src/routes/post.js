const express = require("express");
const router = express.Router();
const {
  createPost,
  updatePost,
  deletePost,
  getAllPosts,
  getUserPostsByUsername,
  getPostById,
  getSheduledPost,
  getUpcomingScheduledPosts,
  searchTaggableUsers,
} = require("../controllers/post");
const {
  createComment,
  deleteComment,
  getPostComments,
} = require("../controllers/comment");
const { likePost, unlikePost, getPostLikes } = require("../controllers/like");
const { verifyUser, optionalVerifyUser } = require("../middlewares/auth");
const { sharePost } = require("../controllers/share");
const {
  trackImpressions,
  trackProfileVisit,
  getPostAnalytics,
} = require("../controllers/analytics");

// Tag Users Search (must be before /:postId routes)
router.get("/tag-users/search", verifyUser, searchTaggableUsers);

// Post Crud
router.post("/", verifyUser, createPost);
router.get("/", verifyUser, getAllPosts);
router.get("/sheduled", verifyUser, getSheduledPost);
router.get("/upcoming-sheduled", verifyUser, getUpcomingScheduledPosts);
router.get("/username/:username", optionalVerifyUser, getUserPostsByUsername);
router.get("/:postId", verifyUser, getPostById);
router.put("/:postId", verifyUser, updatePost);
router.delete("/:postId", verifyUser, deletePost);

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

// Analytics — batch impression tracking (must be before /:postId routes)
router.post("/impression", optionalVerifyUser, trackImpressions);

// Post Analytics — single post
router.get("/:postId/analytics", verifyUser, getPostAnalytics);
router.post("/:postId/profile-visit", verifyUser, trackProfileVisit);

module.exports = router;
