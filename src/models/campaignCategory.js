const mongoose = require("mongoose");

const campaignCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
      unique: true,
    },
  },
  {
    timestamps: true,
    collection: "campaign_category",
  },
);

module.exports = mongoose.model("CampaignCategory", campaignCategorySchema);
