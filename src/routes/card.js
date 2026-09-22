const express = require("express");
const router = express.Router();
const {
  getSavedCards,
  deleteCard,
  addCard,
  setDefaultCard,
} = require("../controllers/card");
const { verifyUser } = require("../middlewares/auth");

router.get("/", verifyUser, getSavedCards);
router.post("/add", verifyUser, addCard);
router.delete("/:paymentMethodId", verifyUser, deleteCard);
router.patch("/:paymentMethodId/default", verifyUser, setDefaultCard);

module.exports = router;

