const Cart = require("../models/cart");
const {
  toVariantArray,
  variantArraysMatch,
  parseQueryVariantArray,
} = require("../utils/variantArrays");
const {
  OWN_PRODUCT_MESSAGE,
  isCreatorBuyingOwnProduct,
} = require("../utils/creatorPurchaseGuard");
const { findProductByProductId } = require("../utils/productId");
const { enrichCartItems } = require("../utils/enrichProductRefs");

const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity = 1, size, colour } = req.body;
    const sizeNorm = toVariantArray(size);
    const colourNorm = toVariantArray(colour);

    if (!productId) {
      return res.status(400).json({ message: "productId is required" });
    }

    if (quantity < 1) {
      return res.status(400).json({ message: "quantity must be at least 1" });
    }

    const product = await findProductByProductId(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (isCreatorBuyingOwnProduct(req.user, product.creatorId)) {
      return res.status(403).json({ message: OWN_PRODUCT_MESSAGE });
    }

    const publicProductId = product.productId;

    let cart = await Cart.findOne({ userId });
    if (!cart) {
      cart = await Cart.create({
        userId,
        creatorId: product.creatorId,
        items: [{
          productId: publicProductId,
          quantity,
          size: sizeNorm,
          colour: colourNorm,
        }],
      });
      return res.status(201).json({
        message: "Item added to cart",
        cart: await enrichCartItems(cart),
      });
    }

    if (String(cart.creatorId) !== String(product.creatorId)) {
      return res.status(400).json({
        message: "You can only add products from one content creator at a time",
      });
    }

    const itemIndex = cart.items.findIndex(
      (item) => item.productId === publicProductId
        && variantArraysMatch(item.size, sizeNorm)
        && variantArraysMatch(item.colour, colourNorm),
    );

    if (itemIndex >= 0) {
      cart.items[itemIndex].quantity += quantity;
    } else {
      cart.items.push({
        productId: publicProductId,
        quantity,
        size: sizeNorm,
        colour: colourNorm,
      });
    }

    await cart.save();

    return res.status(200).json({
      message: "Item added to cart",
      cart: await enrichCartItems(cart),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const cart = await Cart.findOne({ userId });
    if (cart && isCreatorBuyingOwnProduct(req.user, cart.creatorId)) {
      return res.status(403).json({ message: OWN_PRODUCT_MESSAGE });
    }
    return res.status(200).json({ cart: await enrichCartItems(cart) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const removeCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;
    const sizeNorm = parseQueryVariantArray(req.query.size);
    const colourNorm = parseQueryVariantArray(req.query.colour);

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const initialLength = cart.items.length;
    cart.items = cart.items.filter(
      (item) => !(
        item.productId === String(productId).trim()
        && variantArraysMatch(item.size, sizeNorm)
        && variantArraysMatch(item.colour, colourNorm)
      ),
    );

    if (cart.items.length === initialLength) {
      return res.status(404).json({ message: "Product not found in cart" });
    }

    if (cart.items.length === 0) {
      await Cart.deleteOne({ _id: cart._id });
      return res.status(200).json({ message: "Item removed and cart is now empty", cart: null });
    }

    await cart.save();
    return res.status(200).json({
      message: "Item removed from cart",
      cart: await enrichCartItems(cart),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const clearCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(200).json({ message: "Cart already empty" });
    }

    await Cart.deleteOne({ _id: cart._id });
    return res.status(200).json({ message: "Cart cleared successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  addToCart,
  getCart,
  removeCartItem,
  clearCart,
};
