const mongoose = require("mongoose");
const Counter = require("../models/counter");
const Order = require("../models/order");

const ORDER_ID_PREFIX = "ORD";
const ORDER_ID_PAD = 6;
const COUNTER_ID = "order";

const formatOrderId = (seq) =>
  `${ORDER_ID_PREFIX}-${String(seq).padStart(ORDER_ID_PAD, "0")}`;

const parseSeqFromOrderId = (value) => {
  if (!value || typeof value !== "string") return 0;
  const match = value.trim().match(/^ORD-(\d+)$/i);
  return match ? Number(match[1]) : 0;
};

const isObjectIdString = (value) =>
  mongoose.Types.ObjectId.isValid(value)
  && String(value).length === 24
  && String(new mongoose.Types.ObjectId(value)) === String(value);

/**
 * Returns the next sequential order id (e.g. ORD-000001).
 */
const getNextOrderId = async () => {
  const counter = await Counter.findByIdAndUpdate(
    COUNTER_ID,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return formatOrderId(counter.seq);
};

const findOrderByOrderId = async (publicOrderId) => {
  if (publicOrderId == null || publicOrderId === "") return null;
  const id = String(publicOrderId).trim();

  if (isObjectIdString(id)) {
    return Order.findById(id);
  }

  const normalized =
    /^ord-\d+$/i.test(id) ? `ORD-${id.slice(4)}` : id;

  return Order.findOne({
    orderId: { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
  });
};

module.exports = {
  formatOrderId,
  parseSeqFromOrderId,
  getNextOrderId,
  findOrderByOrderId,
  isObjectIdString,
};
