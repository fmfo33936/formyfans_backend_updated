const {
  likeTarget,
  unlikeTarget,
  listLikes,
  createCommentOnTarget,
  deleteCommentOnTarget,
  listComments,
  shareTarget,
} = require("../utils/engagementHelper");
const { schemaValidator } = require("../utils/validator");
const Joi = require("joi");

const shareCampaignSchema = Joi.object({
  campaignId: Joi.string().hex().length(24).required(),
  recipientIds: Joi.array().items(Joi.string()).min(1).required(),
}).unknown(false);

const sendError = (res, err) => {
  const status = err.statusCode || (err.code === 11000 ? 400 : 500);
  const message =
    err.code === 11000 ? "Already liked" : err.message || "Something went wrong";
  return res.status(status).json({ status: "error", message });
};

const likeCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const result = await likeTarget({
      targetType: "campaign",
      targetId: campaignId,
      user: req.user,
      req,
    });
    return res.status(201).json({ status: "success", ...result });
  } catch (err) {
    return sendError(res, err);
  }
};

const unlikeCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const result = await unlikeTarget({
      targetType: "campaign",
      targetId: campaignId,
      user: req.user,
      req,
    });
    return res.status(200).json({ status: "success", ...result });
  } catch (err) {
    return sendError(res, err);
  }
};

const getCampaignLikes = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { data, pagination } = await listLikes({
      targetType: "campaign",
      targetId: campaignId,
      req,
    });
    return res.status(200).json({
      status: "success",
      message: "Likes fetched successfully",
      data,
      pagination,
    });
  } catch (err) {
    return sendError(res, err);
  }
};

const createCampaignComment = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const comment = await createCommentOnTarget({
      targetType: "campaign",
      targetId: campaignId,
      content: req.body.content,
      user: req.user,
      req,
    });
    return res.status(201).json({
      status: "success",
      message: "Comment created successfully",
      comment,
    });
  } catch (err) {
    return sendError(res, err);
  }
};

const getCampaignComments = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { comments, pagination } = await listComments({
      targetType: "campaign",
      targetId: campaignId,
      req,
    });
    return res.status(200).json({
      status: "success",
      message: "Comments fetched successfully",
      comments,
      pagination,
    });
  } catch (err) {
    return sendError(res, err);
  }
};

const deleteCampaignComment = async (req, res) => {
  try {
    const { campaignId, commentId } = req.params;
    const result = await deleteCommentOnTarget({
      targetType: "campaign",
      targetId: campaignId,
      commentId,
      user: req.user,
      req,
    });
    return res.status(200).json({ status: "success", ...result });
  } catch (err) {
    return sendError(res, err);
  }
};

const shareCampaign = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, shareCampaignSchema);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const { campaignId, recipientIds } = validatedData;
    const result = await shareTarget({
      targetType: "campaign",
      targetId: campaignId,
      recipientIds,
      user: req.user,
      req,
      io: req.app.get("socketio"),
    });
    return res.status(200).json({ status: "success", ...result });
  } catch (err) {
    return sendError(res, err);
  }
};

module.exports = {
  likeCampaign,
  unlikeCampaign,
  getCampaignLikes,
  createCampaignComment,
  getCampaignComments,
  deleteCampaignComment,
  shareCampaign,
};
