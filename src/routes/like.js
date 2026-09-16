const express = require("express");
const { verifyUser } = require("../middlewares/auth");
const { likePost, unlikePost, getPostLikes } = require("../controllers/like");
const router = express.Router();

router.post("/:postId/like", verifyUser, likePost);
router.delete("/:postId/unlike", verifyUser, unlikePost);
router.get("/:postId/likes", verifyUser, getPostLikes);

module.exports = router;