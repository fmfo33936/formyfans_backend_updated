const CampaignObjective = require("../models/campaignObjective");
const { parsePagination } = require("../utils/socialHelpers");
const { schemaValidator } = require("../utils/validator");
const {
  createCampaignObjectiveSchema,
  updateCampaignObjectiveSchema,
} = require("../utils/validations");

const createCampaignObjective = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    createCampaignObjectiveSchema,
  );
  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }
  try {
    const objective = await CampaignObjective.create({
      ...validatedData,
    });

    return res.status(201).json({
      message: "Campaign objective created successfully",
      data: objective,
      status: "success",
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ status: "fail", message: "Campaign objective already exists" });
    }
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const updateCampaignObjective = async (req, res) => {
  const { id } = req.params;
  const [error, validatedData] = schemaValidator(
    req.body,
    updateCampaignObjectiveSchema,
  );
  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  try {
    const objective = await CampaignObjective.findByIdAndUpdate(
      id,
      {
        ...validatedData,
      },
      {
        new: true,
        validate: true,
      },
    );

    return res.status(200).json({
      message: "Campaign objective updated successfully",
      data: objective,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ status: "fail", message: "Campaign objective already exists" });
    }
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const getCampaignObjectives = async (req, res) => {
  const { page, limit, skip } = parsePagination(req);

  try {
    const results = await CampaignObjective.aggregate([
      {
        $sort: { createdAt: -1 },
      },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const data = results[0]?.data ?? [];
    const totalCount = results[0]?.metadata[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.status(200).json({
      status: "success",
      message: "Campaign objectives fetched successfully",
      data,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const getCampaignObjectiveById = async (req, res) => {
  try {
    const { id } = req.params;
    const objective = await CampaignObjective.findById(id);

    if (!objective) {
      return res
        .status(404)
        .json({ status: "fail", message: "Campaign objective not found" });
    }

    return res.status(200).json({
      message: "Campaign objective fetched successfully",
      data: objective,
      status: "success",
    });
  } catch (error) {
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const deleteCampaignObjective = async (req, res) => {
  try {
    const { id } = req.params;
    const objective = await CampaignObjective.findByIdAndDelete(id);

    if (!objective) {
      return res
        .status(404)
        .json({ status: "fail", message: "Campaign objective not found" });
    }

    return res.status(200).json({
      status: "success",
      message: "Campaign objective deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

module.exports = {
  createCampaignObjective,
  getCampaignObjectives,
  getCampaignObjectiveById,
  updateCampaignObjective,
  deleteCampaignObjective,
};
