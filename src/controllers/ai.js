const mongoose = require("mongoose");
const s3MediaService = require("../services/s3/s3MediaService");
const aiGenerationService = require("../services/ai/aiGenerationService");
const openaiService = require("../services/ai/openaiService");
const AIPrompt = require("../models/AIPrompt");
const { schemaValidator } = require("../utils/validator");
const {
  presignUploadSchema,
  directUploadSchema,
  refinePromptSchema,
  aiGenerationSchema,
} = require("../utils/validations");
const { successHelper, errorHelper } = require("../utils/helper");

/**
 * 1. Prompt Refinement API
 * Takes a raw prompt and generates an AI-optimized production prompt using OpenAI GPT.
 * POST /api/ai/prompts/refine
 */
const refinePrompt = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(req.body, refinePromptSchema);
    if (error) {
      return errorHelper(res, null, error, 400);
    }

    const { type, prompt, style, settings = {}, videoModificationPrompt } = validatedData;

    const promptResult = await openaiService.refinePrompt({
      userPrompt: prompt || videoModificationPrompt,
      generationType: type,
      settings,
    });

    const savedPrompt = await AIPrompt.create({
      userId: req.user._id,
      type,
      originalPrompt: prompt || videoModificationPrompt,
      refinedPrompt: promptResult.refinedPrompt,
      style: style || "Cinematic, High Quality",
      settings,
    });

    return successHelper(
      res,
      {
        promptId: savedPrompt._id,
        type: savedPrompt.type,
        originalPrompt: savedPrompt.originalPrompt,
        refinedPrompt: savedPrompt.refinedPrompt,
        style: savedPrompt.style,
        createdAt: savedPrompt.createdAt,
      },
      "Prompt refined successfully! You can now review, edit, or proceed to generate.",
      200
    );
  } catch (err) {
    return next(err);
  }
};

/**
 * 1.1 Get Refined Prompt by ID
 * GET /api/ai/prompts/:id
 */
const getRefinedPrompt = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return errorHelper(res, null, "Invalid prompt ID", 400);
    }

    const promptDoc = await AIPrompt.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!promptDoc) {
      return errorHelper(res, null, "Refined prompt not found", 404);
    }

    return successHelper(res, promptDoc, "Refined prompt retrieved successfully", 200);
  } catch (err) {
    return next(err);
  }
};

/**
 * 1.2 List Saved / Refined Prompts
 * GET /api/ai/prompts
 */
const listRefinedPrompts = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const type = req.query.type || null;

    const filter = { userId: req.user._id };
    if (type) filter.type = type;

    const skip = (page - 1) * limit;
    const [prompts, totalCount] = await Promise.all([
      AIPrompt.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      AIPrompt.countDocuments(filter),
    ]);

    return successHelper(
      res,
      {
        data: prompts,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      },
      "Refined prompts retrieved successfully",
      200
    );
  } catch (err) {
    return next(err);
  }
};

/**
 * 2.1 Generates an S3 presigned PUT URL for uploading video/image references directly.
 * POST /api/ai/uploads/presign
 */
const presignUpload = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(req.body, presignUploadSchema);
    if (error) {
      return errorHelper(res, null, error, 400);
    }

    const { fileName, fileType } = validatedData;
    const result = await s3MediaService.createPresignedUploadUrl({
      userId: req.user._id,
      fileName,
      fileType,
    });

    return successHelper(res, result, "Presigned upload URL generated successfully. Use PUT with binary body to upload.", 200);
  } catch (err) {
    return next(err);
  }
};

/**
 * 2.2 Direct Base64 Media Upload to S3
 * POST /api/ai/uploads/direct
 */
const directUpload = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(req.body, directUploadSchema);
    if (error) {
      return errorHelper(res, null, error, 400);
    }

    const { fileName, fileType, base64Data } = validatedData;
    const result = await s3MediaService.uploadBase64({
      userId: req.user._id,
      fileName,
      fileType,
      base64Data,
    });

    return successHelper(res, result, "Media uploaded directly to S3 successfully!", 200);
  } catch (err) {
    return next(err);
  }
};

/**
 * 3. Generate AI Image
 * POST /api/ai/generate/image
 */
const generateImage = async (req, res, next) => {
  req.body.type = "IMAGE";
  return createGeneration(req, res, next);
};

/**
 * 4. Generate AI Video
 * POST /api/ai/generate/video
 */
const generateVideo = async (req, res, next) => {
  req.body.type = "VIDEO";
  return createGeneration(req, res, next);
};

/**
 * 5. Edit AI Video
 * POST /api/ai/generate/video-edit
 */
const editVideo = async (req, res, next) => {
  req.body.type = "VIDEO_EDIT";
  return createGeneration(req, res, next);
};

/**
 * Common unified generation handler
 * POST /api/ai/generations
 */
const createGeneration = async (req, res, next) => {
  try {
    const [error, validatedData] = schemaValidator(req.body, aiGenerationSchema);
    if (error) {
      return errorHelper(res, null, error, 400);
    }

    const type = validatedData.type || req.body.type || "IMAGE";
    validatedData.type = type;

    // Type-specific sanity checks
    if (type === "VIDEO_EDIT" && !validatedData.videoReference) {
      return errorHelper(res, null, "videoReference (S3 key) is required for VIDEO_EDIT generations", 400);
    }
    if ((type === "IMAGE" || type === "VIDEO") && (!validatedData.prompt && !validatedData.refinedPrompt && !validatedData.promptId)) {
      return errorHelper(res, null, "prompt, refinedPrompt, or promptId is required", 400);
    }

    const result = await aiGenerationService.createGeneration({
      userId: req.user._id,
      ...validatedData,
    });

    return successHelper(res, result, `AI ${type.toLowerCase()} generation started. Status is processing.`, 202);
  } catch (err) {
    if (err.message && err.message.includes("Insufficient credits")) {
      return errorHelper(res, null, err.message, 402);
    }
    return next(err);
  }
};

/**
 * Fetches user-friendly status and output of a specific AI Generation.
 * GET /api/ai/generations/:id
 */
const getGeneration = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return errorHelper(res, null, "Invalid generation ID", 400);
    }

    const generation = await aiGenerationService.getGeneration(req.user._id, id);
    return successHelper(res, generation, generation.message, 200);
  } catch (err) {
    if (err.message && err.message.includes("not found")) {
      return errorHelper(res, null, err.message, 404);
    }
    return next(err);
  }
};

/**
 * Lists paginated generation history for authenticated user.
 * GET /api/ai/generations
 */
const listGenerations = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const type = req.query.type || null;

    const result = await aiGenerationService.listUserGenerations(req.user._id, {
      page,
      limit,
      type,
    });

    return successHelper(res, result, "AI Generations retrieved successfully", 200);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  refinePrompt,
  getRefinedPrompt,
  listRefinedPrompts,
  presignUpload,
  directUpload,
  generateImage,
  generateVideo,
  editVideo,
  createGeneration,
  getGeneration,
  listGenerations,
};
