const mongoose = require("mongoose");

const productVariantSchema = new mongoose.Schema(
  {
    size: { type: String, required: true, trim: true },
    colour: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    deliveryCharges: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const productSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    productDetails: { type: String, default: "", trim: true },
    productType: {
      type: String,
      enum: ["normal", "variant"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    totalPrice: { type: Number, min: 0 },
    quantity: { type: Number, min: 0, default: 0 },
    variants: {
      type: [productVariantSchema],
      default: [],
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    deliveryCharges: {
      type: Number,
      default: 0,
      min: 0,
    },
    rating: { type: Number, default: 0 },
    images: {
      type: [String],
      default: [],
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("products", productSchema);
