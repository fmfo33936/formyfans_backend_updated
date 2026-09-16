// routes/favourite.routes.js
const express = require("express");
const router = express.Router();
const { addFavourite, removeFavourite, getMyFavourites } = require("../controllers/favourite");
const { verifyUser } = require("../middlewares/auth");

router.post("/", verifyUser, addFavourite);
router.delete("/:favouriteUserId", verifyUser, removeFavourite);
router.get("/", verifyUser, getMyFavourites);

module.exports = router;