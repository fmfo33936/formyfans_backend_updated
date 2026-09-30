const express = require("express");
const router = express.Router();
const aiController = require("../controllers/ai");
const { verifyUser } = require("../middlewares/auth");
const { promptRateLimit, generationRateLimit, uploadRateLimit } = require("../middlewares/aiRateLimit");

/**
 * AI Content Generation Routes
 * Mounted at /api/ai
 */

// 1. Prompt Refinement Flow
router.post("/prompts/refine", verifyUser, promptRateLimit, aiController.refinePrompt);
router.get("/prompts/:id", verifyUser, aiController.getRefinedPrompt);
router.get("/prompts", verifyUser, aiController.listRefinedPrompts);

// 2. Media Upload to S3
router.post("/uploads/presign", verifyUser, uploadRateLimit, aiController.presignUpload);

// 3. Dedicated Generation Endpoints
router.post("/generate/image", verifyUser, generationRateLimit, aiController.generateImage);
router.post("/generate/video", verifyUser, generationRateLimit, aiController.generateVideo);
router.post("/generate/video-edit", verifyUser, generationRateLimit, aiController.editVideo);

// 4. Common Unified Generation & Polling Endpoints
router.post("/generations", verifyUser, generationRateLimit, aiController.createGeneration);
router.get("/generations/:id", verifyUser, aiController.getGeneration);
router.get("/generations", verifyUser, aiController.listGenerations);

module.exports = router;
