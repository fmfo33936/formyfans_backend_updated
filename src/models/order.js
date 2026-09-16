const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    size: { type: [String], default: [] },
    colour: { type: [String], default: [] },
  },
  { _id: false },
);

const deliverySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    state: { type: String, required: true, trim: true },
    zipCode: { type: String, required: true, trim: true },
    deliveryAddress: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const cardDetailsSchema = new mongoose.Schema(
  {
    cardNumber: { type: String, required: true, trim: true },
    cardExpiry: { type: String, required: true, trim: true },
    nameOnCard: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
    },
    delivery: {
      type: deliverySchema,
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ["online", "cash_on_delivery"],
      required: true,
    },
    cardDetails: {
      type: cardDetailsSchema,
      default: null,
    },
    stripePaymentIntentId: {
      type: String,
      default: null,
      trim: true,
    },
    stripePaymentStatus: {
      type: String,
      default: null,
      trim: true,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    shippingCharges: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "in_progress", "accepted", "delivered"],
      default: "pending",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("orders", orderSchema);
