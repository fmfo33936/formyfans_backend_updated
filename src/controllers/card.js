const { dollarsToCents, getStripe } = require("../utils/stripe");
const stripe = getStripe();
const User = require("../models/auth");

const getSavedCards = async (req, res) => {

    try {
        const user = await User.findById(req.user.id);
        const cards = await stripe.paymentMethods.list({
            customer: user.stripeCustomerId,
            type: "card"
        });
        const response = cards.data.map(card => ({
            id: card.id,
            brand: card.card.brand,
            last4: card.card.last4,
            expMonth: card.card.exp_month,
            expYear: card.card.exp_year,

            isDefault:
                card.id ===
                card.customer.invoice_settings?.default_payment_method

        }));
        const customer = await stripe.customers.retrieve(
            user.stripeCustomerId
        );

        const defaultCard =
            customer.invoice_settings.default_payment_method;

        const data = cards.data.map(card => ({
            id: card.id,
            brand: card.card.brand,
            last4: card.card.last4,
            expMonth: card.card.exp_month,
            expYear: card.card.exp_year,
            isDefault: card.id === defaultCard
        }));

        return res.json({
            success: true,
            cards: data
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

};

const addCard = async (req, res) => {
    try {
        const { paymentMethodId } = req.body;
        const userId = req.user.id || req.user._id;

        if (!paymentMethodId) {
            return res.status(400).json({
                success: false,
                message: "paymentMethodId is required",
            });
        }

        const user = await User.findById(userId).select("+stripeCustomerId email");
        let stripeCustomerId = user?.stripeCustomerId;

        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: user?.email,
                metadata: { userId: user._id.toString() },
            });
            stripeCustomerId = customer.id;
            await User.findByIdAndUpdate(user._id, { stripeCustomerId });
        }

        // Attach payment method to customer
        const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
            customer: stripeCustomerId,
        });

        // Set as default payment method on customer invoice settings
        await stripe.customers.update(stripeCustomerId, {
            invoice_settings: {
                default_payment_method: paymentMethod.id,
            },
        });

        return res.status(200).json({
            success: true,
            message: "Payment method added successfully",
            data: paymentMethod,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err.message,
        });
    }
};

const deleteCard = async (req, res) => {
    try {
        const { paymentMethodId } = req.params;
        await stripe.paymentMethods.detach(paymentMethodId);
        return res.status(200).json({
            success: true,
            message: "Payment method removed successfully",
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err.message,
        });
    }
};

const setDefaultCard = async (req, res) => {
    try {
        const { paymentMethodId } = req.params;
        const userId = req.user.id || req.user._id;
        const user = await User.findById(userId).select("+stripeCustomerId");

        if (!user || !user.stripeCustomerId) {
            return res.status(400).json({
                success: false,
                message: "Stripe customer not found",
            });
        }

        await stripe.customers.update(user.stripeCustomerId, {
            invoice_settings: {
                default_payment_method: paymentMethodId,
            },
        });

        return res.status(200).json({
            success: true,
            message: "Default payment method updated successfully",
            data: { paymentMethodId },
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err.message,
        });
    }
};

module.exports = {
    getSavedCards,
    deleteCard,
    addCard,
    setDefaultCard,
};