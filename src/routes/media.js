const express = require("express");
const router = express.Router();
const { uploadMedia, getMediaByUsername, deleteMedia } = require("../controllers/media");
const { verifyUser } = require("../middlewares/auth");

router.post("/upload", verifyUser, uploadMedia);
router.delete("/:id", verifyUser, deleteMedia);
router.get("/username/:username", verifyUser, getMediaByUsername);

module.exports = router;