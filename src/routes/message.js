const express = require("express");
const {
    getAllMessagesForUser,
} = require("../controllers/message");
const { verifyUser } = require("../middlewares/auth");
const router = express.Router();

router.get("/:id", verifyUser, getAllMessagesForUser);

module.exports = router;
