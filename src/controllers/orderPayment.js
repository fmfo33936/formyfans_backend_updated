const Order = require("../models/order");
const User = require("../models/auth");
const {
  getStripe,
  dollarsToCents,
  centsToDollars,
} = require("../utils/stripe");
const EmailService = require("../utils/emailService");

const STRIPE_CURRENCY = "usd";

/** Public order id only (e.g. ORD-000001) — never Mongo _id */
const resolveOrderByPublicOrderId = async (orderIdParam) => {
  if (orderIdParam == null || orderIdParam === "") return null;
  let id = String(orderIdParam).trim();
  if (/^ord-\d+$/i.test(id)) {
    id = `ORD-${id.slice(4)}`;
  }
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Order.findOne({
    orderId: { $regex: new RegExp(`^${escaped}$`, "i") },
  });
};

const isOrderPaid = (order) => order.stripePaymentStatus === "succeeded";

const apiPaymentStatus = (order) => {
  if (isOrderPaid(order)) return "paid";
  if (order.paymentMethod === "cash_on_delivery") return "not_required";
  return order.stripePaymentStatus || "pending";
};

// const sendOrderPaidEmails = async (order) => {
//   const [buyer, creator] = await Promise.all([
//     User.findById(order.userId).select("firstName lastName email"),
//     User.findById(order.creatorId).select("firstName lastName email"),
//   ]);

//   const buyerEmail = order.delivery?.email || buyer?.email;
//   const creatorEmail = creator?.email;
//   const buyerName =
//     order.delivery?.name
//     || [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ")
//     || "Customer";

//   const tasks = [];
//   if (buyerEmail) {
//     tasks.push(
//       sendEmail(
//         buyerEmail,
//         `Payment confirmed — Order ${order.orderId}`,
//         `Hi ${buyerName},\n\nYour payment for order ${order.orderId} was successful.\nTotal: $${order.totalAmount}\n\nThank you for your purchase!`,
//       ),
//     );
//   }
//   if (creatorEmail) {
//     tasks.push(
//       sendEmail(
//         creatorEmail,
//         `New paid order — ${order.orderId}`,
//         `You received a paid order.\n\nOrder: ${order.orderId}\nTotal: $${order.totalAmount}\nBuyer: ${buyerName}\n\nLog in to view order details.`,
//       ),
//     );
//   }
//   await Promise.allSettled(tasks);
// };

const sendOrderPaidEmails = async (order) => {
  const [buyer, creator] = await Promise.all([
    User.findById(order.userId).select("firstName lastName email"),
    User.findById(order.creatorId).select("firstName lastName email"),
  ]);

  const buyerEmail = order.delivery?.email || buyer?.email;
  const creatorEmail = creator?.email;
  const buyerName =
    order.delivery?.name ||
    [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ") ||
    "Customer";

  const tasks = [];

  if (buyerEmail) {
    const buyerEmailService = new EmailService({ to: buyerEmail });
    tasks.push(
      buyerEmailService.send({
        subject: `Payment confirmed — Order ${order.orderId}`,
        template: "orderPaidBuyerEmail",
        templateData: {
          buyerName,
          orderId: order.orderId,
          totalAmount: order.totalAmount,
          logoUrl:
            "https://res.cloudinary.com/dsvhzxotv/image/upload/v1785517243/images/xnkksicydbm8lc0x2j1c.jpg",
        },
      }),
    );
  }

  if (creatorEmail) {
    const creatorEmailService = new EmailService({ to: creatorEmail });
    tasks.push(
      creatorEmailService.send({
        subject: `New paid order — ${order.orderId}`,
        template: "orderPaidCreatorEmail",
        templateData: {
          buyerName,
          orderId: order.orderId,
          totalAmount: order.totalAmount,
          logoUrl:
            "https://res.cloudinary.com/dsvhzxotv/image/upload/v1785517243/images/xnkksicydbm8lc0x2j1c.jpg",
        },
      }),
    );
  }

  await Promise.allSettled(tasks);
};

const applyPaymentIntentToOrder = async (
  order,
  paymentIntent,
  { sendEmails = false },
) => {
  if (isOrderPaid(order)) {
    return { alreadyPaid: true, order };
  }

  if (paymentIntent.status !== "succeeded") {
    order.stripePaymentIntentId = paymentIntent.id;
    order.stripePaymentStatus = paymentIntent.status;
    await order.save();
    return {
      alreadyPaid: false,
      error: "Payment not completed",
      paymentStatus: paymentIntent.status,
      order,
    };
  }

  order.stripePaymentIntentId = paymentIntent.id;
  order.stripePaymentStatus = "succeeded";
  await order.save();

  if (sendEmails) {
    try {
      await sendOrderPaidEmails(order);
    } catch (emailErr) {
      console.error("Order paid emails failed:", emailErr.message);
    }
  }

  return { alreadyPaid: false, order };
};

const retrieveAndValidatePaymentIntent = async (paymentIntentId, order) => {
  const stripe = getStripe();
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return { error: { status: 400, message: "Invalid payment intent id" } };
  }

  if (
    paymentIntent.metadata?.orderId &&
    String(paymentIntent.metadata.orderId) !== String(order.orderId)
  ) {
    return {
      error: {
        status: 400,
        message: "Payment intent does not match this order",
      },
    };
  }

  return { paymentIntent };
};

/**
 * GET /api/orders/details/:orderId
 */
const getOrderPaymentDetails = async (req, res) => {
  try {
    const order = await resolveOrderByPublicOrderId(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.status(200).json({
      orderId: order.orderId,
      amount: order.totalAmount,
      paymentStatus: apiPaymentStatus(order),
      paymentMethod: order.paymentMethod,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/orders/create-client-secret
 * Body: { amount, orderId }
 */
const createClientSecret = async (req, res) => {
  try {
    const { amount, orderId } = req.body || {};

    if (amount === undefined || amount === null || amount === "") {
      return res.status(400).json({ message: "amount is required" });
    }

    if (!orderId) {
      return res
        .status(400)
        .json({ message: "orderId is required (e.g. ORD-000001)" });
    }

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res
        .status(400)
        .json({ message: "amount must be a positive number" });
    }

    const order = await resolveOrderByPublicOrderId(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const stripe = getStripe();

    if (order.stripePaymentIntentId) {
      const existing = await stripe.paymentIntents.retrieve(
        order.stripePaymentIntentId,
      );
      if (!["succeeded", "canceled"].includes(existing.status)) {
        return res.status(200).json({
          clientSecret: existing.client_secret,
          paymentIntentId: existing.id,
        });
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: dollarsToCents(amountNumber),
      currency: STRIPE_CURRENCY,
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: order.orderId,
      },
    });

    order.stripePaymentIntentId = paymentIntent.id;
    order.stripePaymentStatus = paymentIntent.status;
    await order.save();

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/orders/payment-intent/:orderId
 * Amount from order.totalAmount (public ORD-* id)
 */
const createPaymentIntentForOrder = async (req, res) => {
  try {
    const order = await resolveOrderByPublicOrderId(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (isOrderPaid(order)) {
      return res.status(400).json({ message: "Order is already paid" });
    }

    if (order.totalAmount == null || order.totalAmount <= 0) {
      return res.status(400).json({ message: "Order total not calculated" });
    }

    const customerEmail = order.delivery?.email || "";
    const customerName = order.delivery?.name || "";
    const stripe = getStripe();

    if (order.stripePaymentIntentId) {
      const existing = await stripe.paymentIntents.retrieve(
        order.stripePaymentIntentId,
      );
      if (!["succeeded", "canceled"].includes(existing.status)) {
        return res.status(200).json({
          orderId: order.orderId,
          paymentIntentId: existing.id,
          clientSecret: existing.client_secret,
          amount: centsToDollars(existing.amount),
          currency: STRIPE_CURRENCY.toUpperCase(),
          status: existing.status,
        });
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: dollarsToCents(order.totalAmount),
      currency: STRIPE_CURRENCY,
      description: `Order: ${order.orderId}`,
      receipt_email: customerEmail || undefined,
      metadata: {
        orderId: order.orderId,
        customerEmail,
        customerName,
      },
      automatic_payment_methods: { enabled: true },
    });

    order.stripePaymentIntentId = paymentIntent.id;
    order.stripePaymentStatus = paymentIntent.status;
    await order.save();

    return res.status(200).json({
      orderId: order.orderId,
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: order.totalAmount,
      currency: STRIPE_CURRENCY.toUpperCase(),
      status: paymentIntent.status,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/orders/confirm-payment/:orderId
 * Public ORD-* id — retrieve PI; if succeeded, mark paid (no emails)
 */
const confirmPayment = async (req, res) => {
  try {
    const { paymentIntentId } = req.body || {};

    if (!paymentIntentId) {
      return res.status(400).json({ message: "paymentIntentId is required" });
    }

    const order = await resolveOrderByPublicOrderId(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (isOrderPaid(order)) {
      return res.status(200).json({
        orderId: order.orderId,
        paymentStatus: "paid",
        message: "Order is already marked as paid",
      });
    }

    const { paymentIntent, error } = await retrieveAndValidatePaymentIntent(
      paymentIntentId,
      order,
    );
    if (error) {
      return res.status(error.status).json({ message: error.message });
    }

    const result = await applyPaymentIntentToOrder(order, paymentIntent, {
      sendEmails: false,
    });
    if (result.error) {
      return res.status(400).json({
        message: result.error,
        paymentStatus: result.paymentStatus,
        orderId: order.orderId,
      });
    }

    const updated = await resolveOrderByPublicOrderId(order.orderId);

    return res.status(200).json({
      message: "Payment confirmed",
      orderId: updated.orderId,
      paymentStatus: "paid",
      order: updated,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/orders/update-payment-status/:orderId
 * Public ORD-* id — retrieve PI; if succeeded, mark paid + emails
 */
const updatePaymentStatusFromStripe = async (req, res) => {
  try {
    const { paymentIntentId } = req.body || {};

    if (!paymentIntentId) {
      return res.status(400).json({ message: "paymentIntentId is required" });
    }

    const order = await resolveOrderByPublicOrderId(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (isOrderPaid(order)) {
      return res.status(200).json({
        orderId: order.orderId,
        paymentStatus: "paid",
        message: "Order is already marked as paid",
      });
    }

    const { paymentIntent, error } = await retrieveAndValidatePaymentIntent(
      paymentIntentId,
      order,
    );
    if (error) {
      return res.status(error.status).json({ message: error.message });
    }

    const result = await applyPaymentIntentToOrder(order, paymentIntent, {
      sendEmails: true,
    });
    if (result.error) {
      return res.status(400).json({
        message: result.error,
        paymentStatus: result.paymentStatus,
        orderId: order.orderId,
      });
    }

    const receivedCents = paymentIntent.amount_received ?? paymentIntent.amount;

    return res.status(200).json({
      orderId: order.orderId,
      paymentStatus: "paid",
      orderStatus: order.status,
      amountPaid: centsToDollars(receivedCents),
      currency: STRIPE_CURRENCY.toUpperCase(),
      message: "Order marked as paid",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getOrderPaymentDetails,
  createClientSecret,
  createPaymentIntentForOrder,
  confirmPayment,
  updatePaymentStatusFromStripe,
};
