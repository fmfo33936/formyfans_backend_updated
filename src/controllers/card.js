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

const deleteCard = async (req, res) => {
    try {
        const { paymentMethodId } = req.params;
        await stripe.paymentMethods.detach(paymentMethodId);
        return res.json({
            success: true,
            message: "Card removed successfully."
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

module.exports = {
    getSavedCards,
    deleteCard
}