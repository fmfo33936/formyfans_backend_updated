// models/Media.js
const mongoose = require("mongoose");

const MediaSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: true,
            index: true,
        },
        url:      { type: String, required: true },
        publicId: { type: String, required: true }, 
        type: {
            type: String,
            enum: ["photo", "video"],
            required: true,
        },
        thumbnail: { type: String },   
        thumbnailPublicId: { type: String },
        caption:   { type: String, trim: true, default: "" },
        size:      { type: Number },   
        duration:  { type: Number },   
        visibility: {
            type: String,
            enum: ["public", "followers", "private"],
            default: "public",
        },
    },
    { timestamps: true, collection: "media" }
);

module.exports = mongoose.model("media", MediaSchema);