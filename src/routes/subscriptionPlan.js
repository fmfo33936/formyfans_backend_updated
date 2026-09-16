const express = require("express");
const router = express.Router();
const {
  createPlan,
  fetchPlans,
  updatePlan,
  deletePlan,
} = require("../controllers/subscriptionPlans");
const { verifyAdmin } = require("../middlewares/admin");

router.post("/create", createPlan);
router.get("/fetch", fetchPlans);
router.put("/:planId", verifyAdmin, updatePlan);
router.delete("/:planId", verifyAdmin, deletePlan);

module.exports = router;
