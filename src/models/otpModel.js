const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
});

module.exports = mongoose.model("OTP", otpSchema);