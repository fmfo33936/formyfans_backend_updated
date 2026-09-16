const Counter = require("../models/counter");
const Product = require("../models/product");

const PRODUCT_ID_PREFIX = "PRD";
const PRODUCT_ID_PAD = 6;
const COUNTER_ID = "product";

const formatProductId = (seq) =>
  `${PRODUCT_ID_PREFIX}-${String(seq).padStart(PRODUCT_ID_PAD, "0")}`;

const parseSeqFromProductId = (value) => {
  if (!value || typeof value !== "string") return 0;
  const match = value.trim().match(/^PRD-(\d+)$/i);
  return match ? Number(match[1]) : 0;
};

/**
 * Returns the next sequential product id (e.g. PRD-000001).
 */
const getNextProductId = async () => {
  const counter = await Counter.findByIdAndUpdate(
    COUNTER_ID,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return formatProductId(counter.seq);
};

const findProductByProductId = async (publicProductId) => {
  if (publicProductId == null || publicProductId === "") return null;
  const id = String(publicProductId).trim();
  return Product.findOne({ productId: id });
};

const findProductsByProductIds = async (publicProductIds) => {
  const ids = [...new Set(
    (publicProductIds || []).map((x) => String(x).trim()).filter(Boolean),
  )];
  if (ids.length === 0) return [];
  return Product.find({ productId: { $in: ids } });
};

module.exports = {
  formatProductId,
  parseSeqFromProductId,
  getNextProductId,
  findProductByProductId,
  findProductsByProductIds,
};
