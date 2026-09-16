/**
 * Backfills orderId (ORD-000001) on orders missing it.
 * Run: node scripts/backfill-order-ids.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../src/models/order");
const Counter = require("../src/models/counter");
const { formatOrderId, parseSeqFromOrderId } = require("../src/utils/orderId");

const run = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI or MONGO_URI is required");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  const orders = await Order.find({
    $or: [{ orderId: { $exists: false } }, { orderId: null }, { orderId: "" }],
  }).sort({ createdAt: 1 });

  let seq = 0;
  const existing = await Order.find({ orderId: { $exists: true, $ne: "" } }).select("orderId");
  for (const o of existing) {
    const parsed = parseSeqFromOrderId(o.orderId);
    if (parsed > seq) seq = parsed;
  }

  let updated = 0;
  for (const order of orders) {
    seq += 1;
    order.orderId = formatOrderId(seq);
    await order.save();
    updated += 1;
  }

  await Counter.findByIdAndUpdate(
    "order",
    { seq },
    { upsert: true, setDefaultsOnInsert: true },
  );

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
