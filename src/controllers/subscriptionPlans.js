const SubscriptionPlan = require("../models/subscriptionPlans");

const createPlan = async (req, res) => {
  try {
    const { name, price, durationDays, features, stripePriceId } = req.body;
    if (!name || price === undefined || !durationDays) {
      return res.status(400).json({ message: "name, price and durationDays are required" });
    }
    const existing = await SubscriptionPlan.findOne({ name });
    if (existing) {
      return res.status(400).json({ message: "Plan already exists" });
    }
    const plan = await SubscriptionPlan.create({
      name,
      price,
      durationDays,
      features,
      ...(stripePriceId !== undefined && { stripePriceId }),
    });
    return res.status(201).json({
      message: "Subscription plan created",
      plan,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const fetchPlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find();
    return res.status(200).json({ status: "success", message: "Subscription plans fetched successfully", plans });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updatePlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const { name, price, durationDays, features, isActive, stripePriceId } = req.body;

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    if (name !== undefined) plan.name = name;
    if (price !== undefined) plan.price = price;
    if (durationDays !== undefined) plan.durationDays = durationDays;
    if (features !== undefined) plan.features = features;
    if (isActive !== undefined) plan.isActive = isActive;
    if (stripePriceId !== undefined) plan.stripePriceId = stripePriceId;

    await plan.save();

    return res.status(200).json({
      message: "Subscription plan updated",
      plan,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deletePlan = async (req, res) => {
  try {
    const { planId } = req.params;

    const totalPlans = await SubscriptionPlan.countDocuments();
    if (totalPlans <= 1) {
      return res.status(400).json({
        message: "Cannot delete the last subscription plan. At least one plan must exist.",
      });
    }

    const plan = await SubscriptionPlan.findByIdAndDelete(planId);
    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    return res.status(200).json({ message: "Subscription plan deleted" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = { createPlan, fetchPlans, updatePlan, deletePlan };