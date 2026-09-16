const Product = require("../models/product");
const User = require("../models/auth");
const Subscription = require("../models/userSubscription");
const {
  parseDiscount,
  parseDeliveryCharges,
} = require("../utils/productPricing");
const {
  formatProductResponse,
  formatProductsResponse,
} = require("../utils/formatProduct");
const { variantKey } = require("../utils/variantArrays");
const {
  getNextProductId,
  findProductByProductId,
} = require("../utils/productId");

const parseProductStatus = (value) => {
  if (value === true || value === "true" || value === "active") return "active";
  if (value === false || value === "false" || value === "inactive")
    return "inactive";
  return null;
};

const VARIANT_DISCOUNT_MESSAGE =
  "discount must be set per variant for variant products";
const VARIANT_DELIVERY_MESSAGE =
  "deliveryCharges must be set per variant for variant products";

const normalizeVariants = (variants) => {
  if (!Array.isArray(variants)) return { error: "variants must be an array" };

  const normalized = [];
  const seen = new Set();

  for (const item of variants) {
    const size = item?.size != null ? String(item.size).trim() : "";
    const colour = item?.colour != null ? String(item.colour).trim() : "";
    const quantity = item?.quantity;
    const totalPrice = item?.totalPrice;

    if (!size || !colour) {
      return { error: "Each variant must include size and colour" };
    }
    if (quantity === undefined || quantity === null || Number(quantity) < 0) {
      return {
        error: "Each variant must include a valid quantity (0 or greater)",
      };
    }
    if (
      totalPrice === undefined ||
      totalPrice === null ||
      Number(totalPrice) < 0
    ) {
      return {
        error: "Each variant must include a valid totalPrice (0 or greater)",
      };
    }

    const parsedDiscount = parseDiscount(item?.discount, 0);
    if (parsedDiscount === null) {
      return {
        error: "Each variant discount must be a number between 0 and 100",
      };
    }

    const parsedDeliveryCharges = parseDeliveryCharges(
      item?.deliveryCharges,
      0,
    );
    if (parsedDeliveryCharges === null) {
      return {
        error: "Each variant deliveryCharges must be a number 0 or greater",
      };
    }

    const key = variantKey(size, colour);
    if (seen.has(key)) {
      return {
        error: `Duplicate variant for size "${size}" and colour "${colour}"`,
      };
    }
    seen.add(key);

    normalized.push({
      size,
      colour,
      quantity: Number(quantity),
      totalPrice: Number(totalPrice),
      discount: parsedDiscount,
      deliveryCharges: parsedDeliveryCharges,
    });
  }

  return { variants: normalized };
};

const assertCreatorOwnsProduct = (product, userId) => {
  if (String(product.creatorId) !== String(userId)) {
    return "You can only manage your own products";
  }
  return null;
};

const assertActiveSubscription = async (creatorId) => {
  const activeSubscription = await Subscription.findOne({
    userId: creatorId,
    status: "active",
    endDate: { $gt: new Date() },
  });

  if (!activeSubscription) {
    const hadSubscription = await Subscription.exists({ userId: creatorId });
    const message = hadSubscription
      ? "Your subscription has expired. Please renew to create new products."
      : "You need an active subscription to create products.";
    return message;
  }
  return null;
};

const createProduct = async (req, res) => {
  try {
    const {
      creatorId,
      productType,
      name,
      productDetails = "",
      totalPrice,
      quantity,
      variants,
      discount,
      deliveryCharges,
      rating = 0,
      images,
    } = req.body;

    if (!creatorId) {
      return res.status(400).json({ message: "creatorId is required" });
    }

    const creator = await User.findById(creatorId);
    if (!creator) {
      return res.status(404).json({ message: "Creator not found" });
    }

    if (creator.role !== "creator") {
      return res
        .status(400)
        .json({ message: "creatorId must belong to a user with role creator" });
    }

    if (!productType || !["normal", "variant"].includes(productType)) {
      return res.status(400).json({
        message: "productType is required and must be 'normal' or 'variant'",
      });
    }

    if (!name) {
      return res.status(400).json({ message: "name is required" });
    }

    if (!Array.isArray(images) || images.length === 0) {
      return res
        .status(400)
        .json({ message: "images must be a non-empty array" });
    }

    if (productType === "variant" && discount !== undefined) {
      return res.status(400).json({ message: VARIANT_DISCOUNT_MESSAGE });
    }

    if (productType === "variant" && deliveryCharges !== undefined) {
      return res.status(400).json({ message: VARIANT_DELIVERY_MESSAGE });
    }

    const subscriptionError = await assertActiveSubscription(creatorId);
    if (subscriptionError) {
      return res.status(403).json({ message: subscriptionError });
    }

    const payload = {
      name,
      productDetails,
      productType,
      rating,
      images,
      creatorId,
      status: "active",
    };

    if (productType === "normal") {
      const parsedDeliveryCharges = parseDeliveryCharges(deliveryCharges, 0);
      if (parsedDeliveryCharges === null) {
        return res
          .status(400)
          .json({ message: "deliveryCharges must be a number 0 or greater" });
      }
      payload.deliveryCharges = parsedDeliveryCharges;

      const parsedDiscount = parseDiscount(discount, 0);
      if (parsedDiscount === null) {
        return res
          .status(400)
          .json({ message: "discount must be a number between 0 and 100" });
      }
      payload.discount = parsedDiscount;
      if (totalPrice === undefined || quantity === undefined) {
        return res.status(400).json({
          message: "totalPrice and quantity are required for normal products",
        });
      }
      if (Number(totalPrice) < 0 || Number(quantity) < 0) {
        return res.status(400).json({
          message: "totalPrice and quantity must be 0 or greater",
        });
      }
      payload.totalPrice = Number(totalPrice);
      payload.quantity = Number(quantity);
      payload.variants = [];
    } else {
      const { variants: normalizedVariants, error } =
        normalizeVariants(variants);
      if (error) {
        return res.status(400).json({ message: error });
      }
      if (normalizedVariants.length === 0) {
        return res.status(400).json({
          message: "variants must be a non-empty array for variant products",
        });
      }
      payload.variants = normalizedVariants;
      payload.discount = 0;
      payload.deliveryCharges = 0;
    }

    payload.productId = await getNextProductId();

    const product = await Product.create(payload);

    return res.status(201).json({
      message: "Product created successfully",
      product: formatProductResponse(product),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listProducts = async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === "creator") {
      filter.creatorId = { $ne: req.user._id };
    }

    const products = await Product.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ products: formatProductsResponse(products) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getProductsByCreator = async (req, res) => {
  try {
    const { creatorId } = req.params;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100,
    );
    const skip = (page - 1) * limit;

    const filter = { creatorId };

    const [products, totalProducts] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalProducts / limit) || 1;

    return res.status(200).json({
      message: "Products fetched successfully",
      products: formatProductsResponse(products),
      pagination: {
        page,
        limit,
        totalProducts,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getProductById = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await findProductByProductId(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    await product.populate("creatorId", "firstName lastName email");

    return res.status(200).json({ product: formatProductResponse(product) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const creatorId = req.user._id;

    const product = await findProductByProductId(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const ownershipError = assertCreatorOwnsProduct(product, creatorId);
    if (ownershipError) {
      return res.status(403).json({ message: ownershipError });
    }

    const {
      name,
      productDetails,
      totalPrice,
      quantity,
      variants,
      discount,
      deliveryCharges,
      rating,
      images,
    } = req.body;

    if (name !== undefined) product.name = name;
    if (productDetails !== undefined) product.productDetails = productDetails;
    if (discount !== undefined) {
      if (product.productType === "variant") {
        return res.status(400).json({ message: VARIANT_DISCOUNT_MESSAGE });
      }
      const parsedDiscount = parseDiscount(discount);
      if (parsedDiscount === null) {
        return res
          .status(400)
          .json({ message: "discount must be a number between 0 and 100" });
      }
      product.discount = parsedDiscount;
    }
    if (deliveryCharges !== undefined) {
      if (product.productType === "variant") {
        return res.status(400).json({ message: VARIANT_DELIVERY_MESSAGE });
      }
      const parsedDeliveryCharges = parseDeliveryCharges(deliveryCharges);
      if (parsedDeliveryCharges === null) {
        return res
          .status(400)
          .json({ message: "deliveryCharges must be a number 0 or greater" });
      }
      product.deliveryCharges = parsedDeliveryCharges;
    }
    if (rating !== undefined) product.rating = rating;
    if (images !== undefined) {
      if (!Array.isArray(images) || images.length === 0) {
        return res
          .status(400)
          .json({ message: "images must be a non-empty array" });
      }
      product.images = images;
    }

    if (product.productType === "normal") {
      if (totalPrice !== undefined) product.totalPrice = Number(totalPrice);
      if (quantity !== undefined) product.quantity = Number(quantity);
    } else if (variants !== undefined) {
      const { variants: normalizedVariants, error } =
        normalizeVariants(variants);
      if (error) {
        return res.status(400).json({ message: error });
      }
      if (normalizedVariants.length === 0) {
        return res.status(400).json({
          message: "variants must be a non-empty array for variant products",
        });
      }
      product.variants = normalizedVariants;
    }

    await product.save();

    return res.status(200).json({
      message: "Product updated successfully",
      product: formatProductResponse(product),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const creatorId = req.user._id;

    const product = await findProductByProductId(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const ownershipError = assertCreatorOwnsProduct(product, creatorId);
    if (ownershipError) {
      return res.status(403).json({ message: ownershipError });
    }

    await Product.deleteOne({ productId: product.productId });

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateProductStatus = async (req, res) => {
  try {
    const { productId } = req.params;
    const creatorId = req.user._id;
    const { status } = req.body;

    const parsedStatus = parseProductStatus(status);
    if (!parsedStatus) {
      return res.status(400).json({
        message:
          "status is required and must be active, inactive, true, or false",
      });
    }

    const product = await findProductByProductId(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const ownershipError = assertCreatorOwnsProduct(product, creatorId);
    if (ownershipError) {
      return res.status(403).json({ message: ownershipError });
    }

    product.status = parsedStatus;
    await product.save();

    return res.status(200).json({
      message: "Product status updated successfully",
      product: formatProductResponse(product),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const toggleProductStatus = async (req, res) => {
  try {
    const { productId } = req.params;
    const creatorId = req.user._id;

    const product = await findProductByProductId(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const ownershipError = assertCreatorOwnsProduct(product, creatorId);
    if (ownershipError) {
      return res.status(403).json({ message: ownershipError });
    }

    product.status = product.status === "active" ? "inactive" : "active";
    await product.save();

    return res.status(200).json({
      message: "Product status toggled successfully",
      product: formatProductResponse(product),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createProduct,
  listProducts,
  getProductsByCreator,
  getProductById,
  updateProduct,
  deleteProduct,
  updateProductStatus,
  toggleProductStatus,
};
