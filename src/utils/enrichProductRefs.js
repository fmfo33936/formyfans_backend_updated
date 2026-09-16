const { formatProductResponse } = require("./formatProduct");
const { findProductsByProductIds } = require("./productId");

const buildProductMap = async (productIds) => {
  const products = await findProductsByProductIds(productIds);
  const map = {};
  for (const p of products) {
    map[p.productId] = formatProductResponse(p);
  }
  return map;
};

const enrichCartItems = async (cart) => {
  if (!cart) return null;
  const doc = cart.toObject ? cart.toObject() : { ...cart };
  const productMap = await buildProductMap(doc.items.map((i) => i.productId));
  return {
    ...doc,
    items: doc.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      size: item.size,
      colour: item.colour,
      product: productMap[item.productId] ?? null,
    })),
  };
};

const mapOrderItems = (items, productMap) =>
  (items || []).map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    price: item.price,
    size: item.size,
    colour: item.colour,
    product: productMap[item.productId] ?? null,
  }));

const enrichOrder = async (order) => {
  const doc = order.toObject ? order.toObject() : { ...order };
  const productMap = await buildProductMap((doc.items || []).map((i) => i.productId));
  return {
    ...doc,
    orderId: doc.orderId,
    productIds: (doc.items || []).map((item) => item.productId),
    items: mapOrderItems(doc.items || [], productMap),
  };
};

const enrichOrders = async (orders) => {
  const list = orders.map((o) => (o.toObject ? o.toObject() : { ...o }));
  const allIds = list.flatMap((o) => o.items.map((i) => i.productId));
  const productMap = await buildProductMap(allIds);
  return list.map((doc) => ({
    ...doc,
    orderId: doc.orderId,
    productIds: (doc.items || []).map((item) => item.productId),
    items: mapOrderItems(doc.items, productMap),
  }));
};

module.exports = {
  enrichCartItems,
  enrichOrder,
  enrichOrders,
};
