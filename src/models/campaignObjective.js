const mongoose = require("mongoose");

const campaignObjectiveSchema = new mongoose.Schema(
  {
    icon: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
      unique: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 150,
    },
  },
  {
    timestamps: true,
    collection: "campaign_objective",
  },
);

module.exports = mongoose.model("CampaignObjective", campaignObjectiveSchema);
