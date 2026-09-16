const express = require("express");
const router = express.Router();
const {
  createCampaignCategory,
  getCampaignCategories,
  getCampaignCategoryById,
  updateCampaignCategory,
  deleteCampaignCategory,
} = require("../controllers/campaignCategory");

router.post("/", createCampaignCategory);
router.get("/", getCampaignCategories);
router.get("/:id", getCampaignCategoryById);
router.put("/:id", updateCampaignCategory);
router.delete("/:id", deleteCampaignCategory);

module.exports = router;
