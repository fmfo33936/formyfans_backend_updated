const express = require("express");
const router = express.Router();

const {
   createAdminSettings,
   getAdminSettings,
   updateAdminSettings
} = require("../controllers/adminSettings");

router.post("/create", createAdminSettings);
router.put("/update", updateAdminSettings);
router.get("/", getAdminSettings);

module.exports = router;
