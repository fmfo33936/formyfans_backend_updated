const AdminSettings = require("../models/adminSettings");

const getAdminSettings = async (req, res) => {
    try {
        const settings = await AdminSettings.findOne();
        if (!settings) {
            return res.status(404).json({ message: "Admin settings not found" });
        }
        return res.status(201).json(settings);
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

const createAdminSettings = async (req, res) => {
    try {
        const { dealsPayoutPercentage, fanbugPayoutPercentage, fanSubscriptionPayoutPercentage } = req.body;
        const settings = await AdminSettings.create({ dealsPayoutPercentage, fanbugPayoutPercentage, fanSubscriptionPayoutPercentage });
        return res.status(201).json(settings);
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

const updateAdminSettings = async (req, res) => {
    try {
        const {
            dealsPayoutPercentage,
            fanbugPayoutPercentage,
            fanSubscriptionPayoutPercentage,
        } = req.body;

        const settings = await AdminSettings.findOneAndUpdate(
            {},
            {
                dealsPayoutPercentage,
                fanbugPayoutPercentage,
                fanSubscriptionPayoutPercentage,
            },
            {
                new: true,
                runValidators: true,
            }
        );

        if (!settings) {
            return res.status(404).json({
                message: "Admin settings not found",
            });
        }

        return res.status(200).json(settings);
    } catch (error) {
        return res.status(500).json({
            message: error.message,
        });
    }
};

module.exports = {
    getAdminSettings,
    createAdminSettings,
    updateAdminSettings
};