const express = require("express");
const router = express.Router();
const {
  createCampaignObjective,
  getCampaignObjectives,
  getCampaignObjectiveById,
  updateCampaignObjective,
  deleteCampaignObjective,
} = require("../controllers/campaignObjective");
const { verifyAdmin } = require("../middlewares/admin");

router.post("/", createCampaignObjective);
router.get("/", getCampaignObjectives);
router.get("/:id", getCampaignObjectiveById);
router.put("/:id", updateCampaignObjective);
router.delete("/:id", deleteCampaignObjective);

module.exports = router;
