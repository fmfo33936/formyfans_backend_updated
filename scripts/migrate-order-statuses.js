/**
 * Migrates legacy order statuses to: pending, accepted, in_progress, delivered
 * Run: node scripts/migrate-order-statuses.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../src/models/order");

const MIGRATIONS = [
  { from: "in_process", to: "in_progress" },
  { from: "completed", to: "delivered" },
  { from: "cancelled", to: "pending" },
];

const run = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  for (const { from, to } of MIGRATIONS) {
    const result = await Order.updateMany({ status: from }, { $set: { status: to } });
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
