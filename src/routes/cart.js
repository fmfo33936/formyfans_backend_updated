const express = require("express");
const router = express.Router();
const { addToCart, getCart, removeCartItem, clearCart } = require("../controllers/cart");
const { verifyUser } = require("../middlewares/auth");

router.post("/add", verifyUser, addToCart);
router.get("/", verifyUser, getCart);
router.delete("/item/:productId", verifyUser, removeCartItem);
router.delete("/clear", verifyUser, clearCart);

module.exports = router;
