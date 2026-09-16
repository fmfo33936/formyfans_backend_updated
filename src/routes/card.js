const express = require("express");
const router = express.Router();
const { getSavedCards, deleteCard } = require("../controllers/card");
const { verifyUser } = require("../middlewares/auth");

router.get("/", verifyUser, getSavedCards);
router.delete("/:paymentMethodId", verifyUser, deleteCard);

module.exports = router;
