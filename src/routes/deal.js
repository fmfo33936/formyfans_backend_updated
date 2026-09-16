const express = require("express");
const router = express.Router();

const {
  createDeal,
  getDealById,
  getSentDeals,
  getReceivedDeals,
  acceptDeal,
  rejectDeal,
  cancelDeal,
  pauseDeal,
  resumeDeal,
  getCancelledOrPausedDeals,
  getCompletedDeals,
  getDealsInProgress,
  // completeDeal,
  payForDeal,
  addReview,
  getReceivedDealsInStartStatus,
  verifyDealCompletion,
  requestDealCompletion,
  getAllDealsForAdminDashboard,
  adminVerifyIncompleteDeal,
} = require("../controllers/deal");
const { verifyUser, verifyUserOrAdmin } = require("../middlewares/auth");
const { verifyAdmin } = require("../middlewares/admin");

router.get("/admin/all", verifyUserOrAdmin, getAllDealsForAdminDashboard);
router.patch(
  "/admin/:dealId/verify-incomplete",
  verifyAdmin,
  adminVerifyIncompleteDeal,
);
router.get("/admin/:dealId", verifyAdmin, getDealById); // single deal detail


// login required for all routes
router.use(verifyUser);

// ---------- Create ----------
router.post("/", createDeal); // sender -> create/send new deal

// ---------- Read ----------
router.get("/sent", getSentDeals); // Deals sent to sender
router.get("/received", getReceivedDeals); // Deal gets by receiver
router.get("/completed", getCompletedDeals); // completed deals (either side)
router.get("/in-progress", getDealsInProgress); // accepted + started + completed (either side)
router.get("/received/started", getReceivedDealsInStartStatus); // accepted + started + completed (either side)
router.get("/cancelled-paused", getCancelledOrPausedDeals); // cancelled/paused
router.get("/:dealId", getDealById); // single deal detail

// ---------- Receiver actions ----------
router.patch("/:dealId/accept", acceptDeal);
router.patch("/:dealId/reject", rejectDeal);
router.patch("/:dealId/request-completion", requestDealCompletion);
// router.patch("/:dealId/complete", completeDeal); // started -> completed


// ---------- Sender actions ----------
router.patch("/:dealId/cancel", cancelDeal);
router.patch("/:dealId/pause", pauseDeal);
router.patch("/:dealId/resume", resumeDeal);
router.patch("/:dealId/pay", payForDeal); // accepted -> started
router.patch("/:dealId/verify-completion", verifyDealCompletion);
router.patch("/:dealId/review", addReview); // only once deal is completed




module.exports = router;
