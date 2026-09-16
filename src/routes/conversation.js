const express = require("express");
const {
    createConversation,
    getConversationByUserId,
} = require("../controllers/conversation");
const { verifyUser } = require("../middlewares/auth");
const router = express.Router();

router.post("/", verifyUser, createConversation);
router.get("/", verifyUser, getConversationByUserId);

module.exports = router;
