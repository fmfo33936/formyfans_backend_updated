const CampaignCategory = require("../models/campaignCategory");
const { parsePagination } = require("../utils/socialHelpers");
const { schemaValidator } = require("../utils/validator");
const {
  createCampaignCategorySchema,
  updateCampaignCategorySchema,
} = require("../utils/validations");

const createCampaignCategory = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    createCampaignCategorySchema,
  );

  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  try {
    const category = await CampaignCategory.create({
      ...validatedData,
    });

    return res.status(201).json({
      status: "success",
      message: "Campaign category created successfully",
      data: category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        status: "fail",
        message: "Campaign category already exists",
      });
    }

    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const getCampaignCategories = async (req, res) => {
  const { page, limit, skip } = parsePagination(req);

  try {
    const results = await CampaignCategory.aggregate([
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
      message: "Campaign categories fetched successfully",
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

const getCampaignCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await CampaignCategory.findById(id);

    if (!category) {
      return res.status(404).json({
        status: "fail",
        message: "Campaign category not found",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Campaign category fetched successfully",
      data: category,
    });
  } catch (error) {
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const updateCampaignCategory = async (req, res) => {
  const { id } = req.params;
  const [error, validatedData] = schemaValidator(
    req.body,
    updateCampaignCategorySchema,
  );

  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  try {
    const category = await CampaignCategory.findByIdAndUpdate(
      id,
      { ...validatedData },
      {
        new: true,
        validate: true,
      },
    );

    if (!category) {
      return res.status(404).json({
        status: "fail",
        message: "Campaign category not found",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Campaign category updated successfully",
      data: category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        status: "fail",
        message: "Campaign category already exists",
      });
    }

    return res.status(500).json({ status: "fail", message: error.message });
  }
};

const deleteCampaignCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await CampaignCategory.findByIdAndDelete(id);

    if (!category) {
      return res.status(404).json({
        status: "fail",
        message: "Campaign category not found",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Campaign category deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

module.exports = {
  createCampaignCategory,
  getCampaignCategories,
  getCampaignCategoryById,
  updateCampaignCategory,
  deleteCampaignCategory,
};
