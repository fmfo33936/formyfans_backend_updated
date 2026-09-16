/**
 * Backfills productId (PRD-000001) on all products and migrates cart/order item references.
 * Run: node scripts/backfill-product-ids.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../src/models/product");
const Cart = require("../src/models/cart");
const Order = require("../src/models/order");
const Counter = require("../src/models/counter");
const { formatProductId, parseSeqFromProductId } = require("../src/utils/productId");

const isObjectIdString = (value) => mongoose.Types.ObjectId.isValid(value)
  && String(value).length === 24
  && String(new mongoose.Types.ObjectId(value)) === String(value);

const run = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI or MONGO_URI is required");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  const products = await Product.find({}).sort({ createdAt: 1 });
  let seq = 0;
  const mongoIdToPublicId = new Map();

  for (const product of products) {
    let publicId = product.productId || product.productCode;

    if (!publicId) {
      seq += 1;
      publicId = formatProductId(seq);
      product.productId = publicId;
      product.productCode = undefined;
      await product.save();
    } else if (product.productCode && product.productId !== product.productCode) {
      product.productId = product.productCode;
      product.productCode = undefined;
      await product.save();
    } else if (!product.productId) {
      product.productId = publicId;
      product.productCode = undefined;
      await product.save();
    }

    const parsed = parseSeqFromProductId(publicId);
    if (parsed > seq) seq = parsed;

    mongoIdToPublicId.set(String(product._id), product.productId);
  }

  await Counter.findByIdAndUpdate(
    "product",
    { seq },
    { upsert: true, setDefaultsOnInsert: true },
  );

  const carts = await Cart.find({});
  let cartsUpdated = 0;
  for (const cart of carts) {
    let changed = false;
    for (const item of cart.items) {
      if (isObjectIdString(item.productId)) {
        const mapped = mongoIdToPublicId.get(String(item.productId));
        if (mapped) {
          item.productId = mapped;
          changed = true;
        }
      }
    }
    if (changed) {
      await cart.save();
      cartsUpdated += 1;
    }
  }

  const orders = await Order.find({});
  let ordersUpdated = 0;
  for (const order of orders) {
    let changed = false;
    for (const item of order.items) {
      if (isObjectIdString(item.productId)) {
        const mapped = mongoIdToPublicId.get(String(item.productId));
        if (mapped) {
          item.productId = mapped;
          changed = true;
        }
      }
    }
    if (changed) {
      await order.save();
      ordersUpdated += 1;
    }
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
