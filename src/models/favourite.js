// models/Favourite.js
const mongoose = require("mongoose");

const FavouriteSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: true,
            index: true,
        },
        favouriteUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: true,
        },
    },
    { timestamps: true, collection: "favourites" }
);

FavouriteSchema.index({ userId: 1, favouriteUserId: 1 }, { unique: true });

module.exports = mongoose.model("favourites", FavouriteSchema);