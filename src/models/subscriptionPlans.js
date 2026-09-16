const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    durationDays: {
        type: Number, // e.g. 30 days
        required: true
    },
    features: [String], // optional (like benefits)
    stripePriceId: {
        type: String,
        default: null,
    },
    isActive: {
        type: Boolean,
        default: true
    }

}, { timestamps: true });

module.exports = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);