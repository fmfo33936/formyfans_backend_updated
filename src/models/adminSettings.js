const mongoose = require("mongoose");

const adminSettingsSchema = new mongoose.Schema(
    {
        dealsPayoutPercentage: { type: Number, default: 0.1 }, 
        fanbugPayoutPercentage: { type: Number, default: 0.1 },
        fanSubscriptionPayoutPercentage: { type: Number, default: 0.1 },
    },
    { timestamps: true },
);

module.exports = mongoose.model("AdminSettings", adminSettingsSchema);