const Order = require("../models/order");
const { toVariantArray } = require("../utils/variantArrays");
const { findProductsByProductIds } = require("../utils/productId");
const { getNextOrderId, findOrderByOrderId } = require("../utils/orderId");
const { enrichOrder, enrichOrders } = require("../utils/enrichProductRefs");
const {
  OWN_PRODUCT_MESSAGE,
  isCreatorBuyingOwnProduct,
} = require("../utils/creatorPurchaseGuard");
const { verifyPaymentIntentForOrder } = require("./stripe");
const { getStripe } = require("../utils/stripe");

const ORDER_STATUSES = ["pending", "accepted", "in_progress", "delivered"];

const LEGACY_STATUS_MAP = {
  in_process: "in_progress",
  completed: "delivered",
  cancelled: "pending",
};

const normalizeOrderStatus = (status) => {
  if (status == null || status === "") return null;
  const key = String(status).trim().toLowerCase();
  return LEGACY_STATUS_MAP[key] || key;
};

const BUYER_POPULATE_FIELDS = "firstName lastName email username phoneNumber";
const SELLER_POPULATE_FIELDS = "firstName lastName email username";

const getRefId = (ref) => {
  if (ref == null) return null;
  if (typeof ref === "object" && ref._id != null) return ref._id;
  return ref;
};

const formatBuyer = (userDoc) => {
  if (!userDoc) return null;
  const doc = userDoc.toObject ? userDoc.toObject() : userDoc;
  if (!doc._id && !doc.firstName) return null;
  return {
    id: doc._id,
    firstName: doc.firstName,
    lastName: doc.lastName,
    fullName: [doc.firstName, doc.lastName].filter(Boolean).join(" ").trim(),
    email: doc.email,
    username: doc.username || null,
    phoneNumber: doc.phoneNumber || null,
  };
};

const formatSeller = (userDoc) => {
  if (!userDoc) return null;
  const doc = userDoc.toObject ? userDoc.toObject() : userDoc;
  if (!doc._id && !doc.firstName) return null;
  return {
    id: doc._id,
    firstName: doc.firstName,
    lastName: doc.lastName,
    fullName: [doc.firstName, doc.lastName].filter(Boolean).join(" ").trim(),
    email: doc.email,
    username: doc.username || null,
  };
};

const buildOrderDetails = (enrichedOrder) => {
  const items = formatLineItems(enrichedOrder.items);
  return {
    items,
    productIds: enrichedOrder.productIds ?? items.map((i) => i.productId),
    delivery: enrichedOrder.delivery ?? null,
    payment: formatPaymentForShop(enrichedOrder),
    subtotal: enrichedOrder.subtotal,
    discountAmount: enrichedOrder.discountAmount ?? 0,
    shippingCharges: enrichedOrder.shippingCharges,
    totalAmount: enrichedOrder.totalAmount,
  };
};

/** Shared order detail shape for user (buyer), creator (buyer or shop), and admin. */
const buildOrderDetailResponse = (
  enrichedOrder,
  populatedOrder,
  { isAdmin, isBuyer, isShopOwner },
) => {
  const payload = {
    orderId: enrichedOrder.orderId,
    status: enrichedOrder.status,
    placedAt: enrichedOrder.createdAt,
    updatedAt: enrichedOrder.updatedAt,
    orderDetails: buildOrderDetails(enrichedOrder),
  };

  if (isAdmin || isShopOwner) {
    payload.buyer = formatBuyer(populatedOrder.userId);
  }
  if (isAdmin || isBuyer) {
    payload.seller = formatSeller(populatedOrder.creatorId);
  }

  return payload;
};

const formatPaymentForShop = (order) => {
  const payment = { method: order.paymentMethod };
  if (order.stripePaymentIntentId) {
    payment.provider = "stripe";
    payment.paymentIntentId = order.stripePaymentIntentId;
    payment.status = order.stripePaymentStatus || null;
  }
  if (order.paymentMethod === "online" && order.cardDetails) {
    const card = order.cardDetails;
    const num = String(card.cardNumber || "");
    payment.nameOnCard = card.nameOnCard;
    payment.cardExpiry = card.cardExpiry;
    payment.cardLast4 = num.length >= 4 ? num.slice(-4) : null;
  }
  return payment;
};

const formatLineItems = (items = []) =>
  items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.price,
    lineTotal: Math.round(item.quantity * item.price * 100) / 100,
    size: item.size ?? [],
    colour: item.colour ?? [],
    product: item.product ?? null,
  }));

/** Creator shop list — same detail shape with buyer + orderDetails. */
const formatShopOrderForCreator = (enrichedOrder, populatedOrder) =>
  buildOrderDetailResponse(enrichedOrder, populatedOrder ?? enrichedOrder, {
    isAdmin: false,
    isBuyer: false,
    isShopOwner: true,
  });

const normalizeStr = (v) => String(v ?? "").trim();

const parseNonNegativeNumber = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return { error: `${fieldName} is required` };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { error: `${fieldName} must be a number 0 or greater` };
  }
  return { value: Math.round(n * 100) / 100 };
};

const normalizeOptionalVariant = (value) => {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return toVariantArray(value);
};

const normalizeDelivery = (body) => {
  const source = body.delivery || body.shipping;
  if (!source || typeof source !== "object") {
    return { error: "delivery object is required" };
  }

  const name = source.name ?? source.fullName;
  const phoneNumber = source.phoneNumber ?? source.phone;
  const city = source.city;
  const email = source.email;
  const state = source.state;
  const zipCode = source.zipCode ?? source.zip;
  const deliveryAddress = source.deliveryAddress ?? source.address;

  const fields = {
    name,
    phoneNumber,
    city,
    email,
    state,
    zipCode,
    deliveryAddress,
  };

  const missing = Object.entries(fields)
    .filter(([, val]) => !normalizeStr(val))
    .map(([key]) => key);

  if (missing.length > 0) {
    return {
      error: `delivery is missing required fields: ${missing.join(", ")}`,
    };
  }

  return {
    delivery: {
      name: normalizeStr(name),
      phoneNumber: normalizeStr(phoneNumber),
      city: normalizeStr(city),
      email: normalizeStr(email).toLowerCase(),
      state: normalizeStr(state),
      zipCode: normalizeStr(zipCode),
      deliveryAddress: normalizeStr(deliveryAddress),
    },
  };
};

const normalizeCardDetails = (cardDetails) => {
  if (!cardDetails || typeof cardDetails !== "object") {
    return { error: "cardDetails is required for online payment" };
  }

  const cardNumber = cardDetails.cardNumber;
  const cardExpiry = cardDetails.cardExpiry;
  const nameOnCard = cardDetails.nameOnCard;
  const cardSecurityNumber = cardDetails.cardSecurityNumber;

  const fields = { cardNumber, cardExpiry, nameOnCard, cardSecurityNumber };
  const missing = Object.entries(fields)
    .filter(([, val]) => !normalizeStr(val))
    .map(([key]) => key);

  if (missing.length > 0) {
    return {
      error: `cardDetails is missing required fields: ${missing.join(", ")}`,
    };
  }

  return {
    cardDetails: {
      cardNumber: normalizeStr(cardNumber),
      cardExpiry: normalizeStr(cardExpiry),
      nameOnCard: normalizeStr(nameOnCard),
    },
  };
};

const createOrder = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const {
      creatorId,
      items,
      paymentMethod,
      cardDetails,
      stripePaymentIntentId,
      subtotal,
      shipping,
      shippingCharges,
      total,
      totalAmount,
      discountAmount = 0,
    } = req.body;

    if (!creatorId || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({
          message: "creatorId and items (non-empty array) are required",
        });
    }

    const { delivery, error: deliveryError } = normalizeDelivery(req.body);
    if (deliveryError) {
      return res.status(400).json({ message: deliveryError });
    }

    if (paymentMethod !== "online" && paymentMethod !== "cash_on_delivery") {
      return res.status(400).json({
        message: 'paymentMethod must be "online" or "cash_on_delivery"',
      });
    }

    let storedCardDetails = null;
    let stripePaymentId = null;
    let stripePaymentStatus = null;

    const parsedSubtotal = parseNonNegativeNumber(subtotal, "subtotal");
    if (parsedSubtotal.error) {
      return res.status(400).json({ message: parsedSubtotal.error });
    }

    const shippingValue =
      shippingCharges !== undefined ? shippingCharges : shipping;
    const parsedShipping = parseNonNegativeNumber(shippingValue, "shipping");
    if (parsedShipping.error) {
      return res.status(400).json({ message: parsedShipping.error });
    }

    const totalValue = totalAmount !== undefined ? totalAmount : total;
    const parsedTotal = parseNonNegativeNumber(totalValue, "total");
    if (parsedTotal.error) {
      return res.status(400).json({ message: parsedTotal.error });
    }

    const parsedDiscount = parseNonNegativeNumber(
      discountAmount,
      "discountAmount",
    );
    if (parsedDiscount.error) {
      return res.status(400).json({ message: parsedDiscount.error });
    }

    if (paymentMethod === "online") {
      const intentId = normalizeStr(stripePaymentIntentId);
      if (intentId) {
        const {
          error: payError,
          status,
          paymentIntent,
        } = await verifyPaymentIntentForOrder(
          intentId,
          parsedTotal.value,
          userId,
        );
        if (payError) {
          return res
            .status(400)
            .json({ message: payError, status: status || undefined });
        }
        stripePaymentId = paymentIntent.id;
        stripePaymentStatus = paymentIntent.status;
      } else if (cardDetails) {
        const { cardDetails: normalizedCard, error: cardError } =
          normalizeCardDetails(cardDetails);
        if (cardError) {
          return res.status(400).json({ message: cardError });
        }
        storedCardDetails = normalizedCard;
      } else {
        stripePaymentStatus = "pending";
      }
    }

    if (isCreatorBuyingOwnProduct(req.user, creatorId)) {
      return res.status(403).json({ message: OWN_PRODUCT_MESSAGE });
    }

    const requestedProductIds = items.map((i) => String(i.productId).trim());
    const products = await findProductsByProductIds(requestedProductIds);

    if (products.length !== new Set(requestedProductIds).size) {
      return res
        .status(400)
        .json({ message: "One or more products not found" });
    }

    const orderItems = [];

    for (const item of items) {
      const product = products.find(
        (p) => p.productId === String(item.productId).trim(),
      );
      if (!product) {
        return res
          .status(400)
          .json({ message: "One or more products not found" });
      }

      if (String(product.creatorId) !== String(creatorId)) {
        return res.status(400).json({
          message: `Product "${product.name}" does not belong to the specified creator`,
        });
      }

      if (isCreatorBuyingOwnProduct(req.user, product.creatorId)) {
        return res.status(403).json({ message: OWN_PRODUCT_MESSAGE });
      }

      const parsedPrice = parseNonNegativeNumber(item.price, "item.price");
      if (parsedPrice.error) {
        return res.status(400).json({ message: parsedPrice.error });
      }

      const qty = Math.max(parseInt(item.quantity, 10) || 1, 1);

      orderItems.push({
        productId: product.productId,
        quantity: qty,
        price: parsedPrice.value,
        size: normalizeOptionalVariant(item.size),
        colour: normalizeOptionalVariant(item.colour ?? item.color),
      });
    }

    const publicOrderId = await getNextOrderId();

    const order = await Order.create({
      orderId: publicOrderId,
      userId,
      creatorId,
      items: orderItems,
      delivery,
      paymentMethod,
      cardDetails: storedCardDetails,
      stripePaymentIntentId: stripePaymentId,
      stripePaymentStatus,
      subtotal: parsedSubtotal.value,
      discountAmount: parsedDiscount.value,
      shippingCharges: parsedShipping.value,
      totalAmount: parsedTotal.value,
      status: "pending",
    });

    if (stripePaymentId) {
      try {
        await getStripe().paymentIntents.update(stripePaymentId, {
          metadata: {
            userId: String(userId),
            orderId: publicOrderId,
          },
        });
      } catch {
        // order is already created; metadata update is optional
      }
    }

    const enrichedOrder = await enrichOrder(order);

    return res.status(201).json({
      message: "Order placed successfully",
      orderId: order.orderId,
      productIds: orderItems.map((item) => item.productId),
      order: enrichedOrder,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/** Orders placed on this creator's shop — who bought, what, delivery, totals. */
const getCreatorShopOrders = async (req, res) => {
  try {
    const creatorId = req.user._id || req.user.id;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100,
    );
    const skip = (page - 1) * limit;

    const filter = { creatorId };

    const { status } = req.query;
    const normalizedStatus = normalizeOrderStatus(status);
    if (normalizedStatus && ORDER_STATUSES.includes(normalizedStatus)) {
      filter.status = normalizedStatus;
    }

    const [orders, totalOrders] = await Promise.all([
      Order.find(filter)
        .populate("userId", BUYER_POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalOrders / limit) || 1;
    const enrichedList = await enrichOrders(orders);
    const ordersPayload = enrichedList.map((enriched, index) =>
      formatShopOrderForCreator(enriched, orders[index]),
    );

    return res.status(200).json({
      message: "Shop orders fetched successfully",
      orders: ordersPayload,
      orderIds: ordersPayload.map((o) => o.orderId).filter(Boolean),
      pagination: {
        page,
        limit,
        totalOrders,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getUserOrders = async (req, res) => {
  try {
    const accountId = req.user._id || req.user.id;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100,
    );
    const skip = (page - 1) * limit;

    const filter = { userId: accountId };

    const { status } = req.query;
    const normalizedStatus = normalizeOrderStatus(status);
    if (normalizedStatus && ORDER_STATUSES.includes(normalizedStatus)) {
      filter.status = normalizedStatus;
    }

    const [orders, totalOrders] = await Promise.all([
      Order.find(filter)
        .populate("creatorId", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalOrders / limit) || 1;

    const enrichedOrders = await enrichOrders(orders);

    return res.status(200).json({
      message: "Orders fetched successfully",
      orders: enrichedOrders,
      orderIds: enrichedOrders.map((o) => o.orderId).filter(Boolean),
      pagination: {
        page,
        limit,
        totalOrders,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await findOrderByOrderId(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const isAdmin = Boolean(req.admin);
    const accountId = isAdmin ? null : req.user?._id || req.user?.id;
    const isBuyer =
      isAdmin ||
      (accountId != null &&
        String(getRefId(order.userId)) === String(accountId));
    const isShopOwner =
      isAdmin ||
      (req.role === "creator" &&
        accountId != null &&
        String(getRefId(order.creatorId)) === String(accountId));

    if (!isAdmin && !isBuyer && !isShopOwner) {
      return res.status(404).json({ message: "Order not found" });
    }

    await order.populate([
      { path: "userId", select: BUYER_POPULATE_FIELDS },
      { path: "creatorId", select: SELLER_POPULATE_FIELDS },
    ]);

    const enrichedOrder = await enrichOrder(order);
    const orderPayload = buildOrderDetailResponse(enrichedOrder, order, {
      isAdmin,
      isBuyer,
      isShopOwner,
    });

    return res.status(200).json({
      message: "Order fetched successfully",
      orderId: orderPayload.orderId,
      order: orderPayload,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const cancelOrder = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { orderId } = req.params;

    const order = await findOrderByOrderId(orderId);
    if (!order || String(order.userId) !== String(userId)) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.status !== "pending") {
      return res.status(400).json({
        message: `Cannot cancel order with status "${order.status}". Only pending orders can be cancelled.`,
      });
    }

    const publicOrderId = order.orderId;
    await Order.deleteOne({ _id: order._id });

    return res.status(200).json({
      message: "Order cancelled successfully",
      orderId: publicOrderId,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAllOrders = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100,
    );
    const skip = (page - 1) * limit;

    const filter = {};
    const { status } = req.query;
    const normalizedStatus = normalizeOrderStatus(status);
    if (normalizedStatus && ORDER_STATUSES.includes(normalizedStatus)) {
      filter.status = normalizedStatus;
    }

    if (!req.admin && req.user) {
      const accountId = req.user._id || req.user.id;
      if (req.role === "creator") {
        filter.creatorId = accountId;
      } else {
        filter.userId = accountId;
      }
    }

    const [orders, totalOrders] = await Promise.all([
      Order.find(filter)
        .populate("userId", "firstName lastName email")
        .populate("creatorId", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalOrders / limit) || 1;

    const enrichedOrders = await enrichOrders(orders);

    return res.status(200).json({
      message: "Orders fetched successfully",
      orders: enrichedOrders,
      orderIds: enrichedOrders.map((o) => o.orderId).filter(Boolean),
      pagination: {
        page,
        limit,
        totalOrders,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: "status is required" });
    }

    const normalizedStatus = normalizeOrderStatus(status);
    if (!normalizedStatus || !ORDER_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        message: "status must be pending, accepted, in_progress, or delivered",
      });
    }

    const existing = await findOrderByOrderId(orderId);
    if (!existing) {
      return res.status(404).json({ message: "Order not found" });
    }

    const creatorId = req.user._id || req.user.id;
    if (String(existing.creatorId) !== String(creatorId)) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = await Order.findByIdAndUpdate(
      existing._id,
      { status: normalizedStatus },
      { new: true },
    );

    await order.populate("userId", BUYER_POPULATE_FIELDS);
    const enrichedOrder = await enrichOrder(order);
    const orderPayload = formatShopOrderForCreator(enrichedOrder, order);

    return res.status(200).json({
      message: "Order status updated successfully",
      orderId: orderPayload.orderId,
      order: orderPayload,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createOrder,
  getUserOrders,
  getCreatorShopOrders,
  getOrderById,
  cancelOrder,
  getAllOrders,
  updateOrderStatus,
};
