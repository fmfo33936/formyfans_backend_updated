const { toVariantArray, variantKey } = require("./variantArrays");

const parseDiscount = (value, defaultValue = 0) => {
  if (value === undefined || value === null) return defaultValue;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
};

const parseDeliveryCharges = (value, defaultValue = 0) => {
  if (value === undefined || value === null) return defaultValue;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const resolveLineUnitPrice = (product, size, colour) => {
  if (product.productType === "normal") {
    if (product.totalPrice == null) {
      return { error: "Product has no price configured" };
    }
    return { price: Number(product.totalPrice) };
  }

  const sizes = toVariantArray(size);
  const colours = toVariantArray(colour);

  if (sizes.length !== 1 || colours.length !== 1) {
    return {
      error: "Variant products require exactly one size and one colour per order line",
    };
  }

  const key = variantKey(sizes[0], colours[0]);
  const match = (product.variants || []).find(
    (v) => variantKey(v.size, v.colour) === key,
  );

  if (!match) {
    return {
      error: `No variant found for size "${sizes[0]}" and colour "${colours[0]}" on product "${product.name}"`,
    };
  }

  return { price: Number(match.totalPrice) };
};

const resolveLineDiscountPct = (product, size, colour) => {
  if (product.productType === "normal") {
    return parseDiscount(product?.discount, 0);
  }

  const sizes = toVariantArray(size);
  const colours = toVariantArray(colour);
  const key = variantKey(sizes[0], colours[0]);
  const match = (product.variants || []).find(
    (v) => variantKey(v.size, v.colour) === key,
  );

  return parseDiscount(match?.discount, 0);
};

/**
 * Applies discount per order line (variant products use each variant's discount %).
 */
const computeDiscountedSubtotal = (lines, productMap) => {
  let subtotal = 0;
  let discountAmount = 0;

  for (const line of lines) {
    const product = productMap[String(line.productId)];
    const pct = resolveLineDiscountPct(product, line.size, line.colour);
    const savings = line.lineTotal * (pct / 100);
    discountAmount += savings;
    subtotal += line.lineTotal - savings;
  }

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
  };
};

module.exports = {
  parseDiscount,
  parseDeliveryCharges,
  resolveLineUnitPrice,
  resolveLineDiscountPct,
  computeDiscountedSubtotal,
};
