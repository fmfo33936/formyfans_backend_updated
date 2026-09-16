/**
 * Normalizes product documents for API responses.
 * Variant products expose per-variant price/qty plus rolled-up totals for listing UIs.
 */
const formatProductResponse = (product) => {
  const doc = product?.toObject ? product.toObject({ virtuals: true }) : { ...product };

  const base = {
    productId: doc.productId,
    name: doc.name,
    productDetails: doc.productDetails ?? "",
    productType: doc.productType,
    status: doc.status,
    rating: doc.rating ?? 0,
    images: doc.images ?? [],
    creatorId: doc.creatorId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };

  if (doc.productType === "variant") {
    const variants = (doc.variants || []).filter(Boolean).map((v) => ({
      _id: v._id,
      size: v.size,
      colour: v.colour,
      quantity: Number(v.quantity ?? 0),
      totalPrice: Number(v.totalPrice ?? 0),
      discount: Number(v.discount ?? 0),
      deliveryCharges: Number(v.deliveryCharges ?? 0),
    }));

    const prices = variants.map((v) => v.totalPrice);
    const totalQuantity = variants.reduce((sum, v) => sum + v.quantity, 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

    return {
      ...base,
      variants,
      quantity: totalQuantity,
      totalQuantity,
      totalPrice: minPrice,
      minPrice,
      maxPrice,
    };
  }

  return {
    ...base,
    discount: doc.discount ?? 0,
    deliveryCharges: Number(doc.deliveryCharges ?? 0),
    totalPrice: doc.totalPrice != null ? Number(doc.totalPrice) : null,
    quantity: doc.quantity != null ? Number(doc.quantity) : 0,
    totalQuantity: doc.quantity != null ? Number(doc.quantity) : 0,
    variants: [],
    minPrice: doc.totalPrice != null ? Number(doc.totalPrice) : null,
    maxPrice: doc.totalPrice != null ? Number(doc.totalPrice) : null,
  };
};

const formatProductsResponse = (products) =>
  products.map((p) => formatProductResponse(p));

module.exports = {
  formatProductResponse,
  formatProductsResponse,
};
