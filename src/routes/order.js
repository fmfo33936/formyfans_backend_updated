const express = require("express");
const router = express.Router();
const {
  createOrder,
  getUserOrders,
  getCreatorShopOrders,
  getAllOrders,
  getOrderById,
  cancelOrder,
  updateOrderStatus,
} = require("../controllers/order");
const {
  getOrderPaymentDetails,
  createClientSecret,
  createPaymentIntentForOrder,
  confirmPayment,
  updatePaymentStatusFromStripe,
} = require("../controllers/orderPayment");
const {
  verifyUser,
  verifyUserOrAdmin,
  verifyContentCreator,
} = require("../middlewares/auth");

router.post("/create", verifyUser, createOrder);
router.get("/", verifyUserOrAdmin, getAllOrders);
router.get("/my", verifyUser, getUserOrders);
router.get("/shop", verifyContentCreator, getCreatorShopOrders);

router.get("/details/:orderId", getOrderPaymentDetails);
router.post("/create-client-secret", createClientSecret);
router.post("/payment-intent/:orderId", createPaymentIntentForOrder);
router.post("/confirm-payment/:orderId", confirmPayment);
router.post("/update-payment-status/:orderId", updatePaymentStatusFromStripe);

router.get("/:orderId", verifyUserOrAdmin, getOrderById);
router.patch("/:orderId/status", verifyContentCreator, updateOrderStatus);
router.patch("/:orderId/cancel", verifyUser, cancelOrder);

module.exports = router;
