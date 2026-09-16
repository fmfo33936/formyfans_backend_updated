const express = require("express");
const router = express.Router();
const {
  createProduct,
  listProducts,
  getProductsByCreator,
  getProductById,
  updateProduct,
  deleteProduct,
  updateProductStatus,
  toggleProductStatus,
} = require("../controllers/product");
const { verifyUser, verifyVerifiedContentCreator } = require("../middlewares/auth");

router.get("/list", verifyUser, listProducts);
router.get("/creator/:creatorId", getProductsByCreator);
router.post("/create", createProduct);
router.patch("/:productId/status/toggle", verifyVerifiedContentCreator, toggleProductStatus);
router.patch("/:productId/status", verifyVerifiedContentCreator, updateProductStatus);
router.get("/:productId", getProductById);
router.put("/:productId", verifyVerifiedContentCreator, updateProduct);
router.delete("/:productId", verifyVerifiedContentCreator, deleteProduct);

module.exports = router;
