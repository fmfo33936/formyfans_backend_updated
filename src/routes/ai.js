const express = require("express");
const router = express.Router();
const aiController = require("../controllers/ai");
const { verifyUser } = require("../middlewares/auth");

/**
 * AI Content Generation Routes
 * Mounted at /api/ai
 */

// 1. Prompt Refinement Flow
router.post("/prompts/refine", verifyUser, aiController.refinePrompt);
router.get("/prompts/:id", verifyUser, aiController.getRefinedPrompt);
router.get("/prompts", verifyUser, aiController.listRefinedPrompts);

// 2. Media Upload to S3
router.post("/uploads/presign", verifyUser, aiController.presignUpload);
router.post("/uploads/direct", verifyUser, aiController.directUpload);

// 3. Dedicated Generation Endpoints
router.post("/generate/image", verifyUser, aiController.generateImage);
router.post("/generate/video", verifyUser, aiController.generateVideo);
router.post("/generate/video-edit", verifyUser, aiController.editVideo);

// 4. Common Unified Generation & Polling Endpoints
router.post("/generations", verifyUser, aiController.createGeneration);
router.get("/generations/:id", verifyUser, aiController.getGeneration);
router.get("/generations", verifyUser, aiController.listGenerations);

module.exports = router;
