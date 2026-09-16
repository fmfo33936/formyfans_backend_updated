const express = require("express");
const router = express.Router();
const {
  createBoost,
  estimateReach,
  finalizeBoost,
} = require("../controllers/boost");
const { verifyUser } = require("../middlewares/auth");
const {
  trackWebsiteClick,
  getCreatorBoostAnalytics,
} = require("../controllers/analytics");

// POST /api/boost/estimate-reach
router.post("/estimate-reach", verifyUser, estimateReach);
router.post("/:boostId/finalize", verifyUser, finalizeBoost);

// POST /api/boost — create a boosted post.
router.post("/", verifyUser, createBoost);

// GET /api/boost/my-analytics — creator dashboard (all boosted posts)
router.get("/my-analytics", verifyUser, getCreatorBoostAnalytics);

// Analytics — website click tracking
router.post("/:boostId/website-click", verifyUser, trackWebsiteClick);

module.exports = router;
