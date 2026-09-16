const express = require("express");
const router = express.Router();
const {
  createCampaign,
  confirmCampaignPayment,
  retryCampaignPayment,
  getCampaigns,
  getAllCampaigns,
  getCampaignById,
  deleteCampaign,
  updateCampaign,
  calculateCampaignEstimatedReach,
} = require("../controllers/campaign");
const {
  likeCampaign,
  unlikeCampaign,
  getCampaignLikes,
  createCampaignComment,
  getCampaignComments,
  deleteCampaignComment,
  shareCampaign,
} = require("../controllers/campaignEngagement");
const { verifyUser } = require("../middlewares/auth");
const { verifyAdmin } = require("../middlewares/admin");

router.get("/admin/all", verifyAdmin, getAllCampaigns);
router.post("/estimated-reach", verifyUser, calculateCampaignEstimatedReach);
router.post("/share", verifyUser, shareCampaign);
router.post("/", verifyUser, createCampaign);
router.post("/confirm-payment", verifyUser, confirmCampaignPayment);
router.post("/retry-payment", verifyUser, retryCampaignPayment);
router.get("/", verifyUser, getCampaigns);

router.post("/:campaignId/like", verifyUser, likeCampaign);
router.delete("/:campaignId/unlike", verifyUser, unlikeCampaign);
router.get("/:campaignId/likes", verifyUser, getCampaignLikes);
router.post("/:campaignId/comments", verifyUser, createCampaignComment);
router.get("/:campaignId/comments", verifyUser, getCampaignComments);
router.delete(
  "/:campaignId/comments/:commentId",
  verifyUser,
  deleteCampaignComment,
);

router.put("/:id", verifyUser, updateCampaign);
router.get("/:id", verifyUser, getCampaignById);
router.delete("/:id", verifyUser, deleteCampaign);

module.exports = router;
