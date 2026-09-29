const express = require("express");
const router = express.Router();
const creditsController = require("../controllers/credits");
const { verifyUser } = require("../middlewares/auth");
const { verifyAdmin } = require("../middlewares/admin");

/**
 * Platform Credits & Payment Routes
 * Mounted at /api/credits
 */

// User balance
router.get("/balance", verifyUser, creditsController.getBalance);

// User transaction ledger
router.get("/transactions", verifyUser, creditsController.getTransactions);

// Credit pricing & single plan details
router.get("/pricing", creditsController.getPricing);

// Dynamic price calculator for credit amount selection
router.post("/calculate-price", verifyUser, creditsController.calculatePrice);

// Initiate purchase via Stripe PaymentIntent
router.post("/purchase", verifyUser, creditsController.createPurchasePaymentIntent);

// Verify completed Stripe payment and credit account
router.post("/verify-payment", verifyUser, creditsController.verifyPayment);

// Dedicated AI subscription & credit purchase payment history
router.get("/history", verifyUser, creditsController.getPaymentHistory);

// Admin update of pricing and conversion rules
router.put("/pricing", verifyAdmin, creditsController.updatePricing);

module.exports = router;
