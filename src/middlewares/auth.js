const jwt = require("jsonwebtoken");
const User = require("../models/auth");
const Admin = require("../models/admin");
const { errorHelper } = require("../utils/helper");

const getTokenFromHeader = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.split(" ")[1];
};

const verifyUser = async (req, res, next) => {
  const token = getTokenFromHeader(req);
  if (!token) {
    return errorHelper(res, null, "Unauthorized: No token provided", 401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role === "admin") {
      return errorHelper(
        res,
        null,
        "This endpoint requires a user token.",
        403,
      );
    }

    const user = await User.findById(decoded.id).select(
      "_id firstName lastName email role status isVerified tokenVersion",
    );

    if (!user) {
      console.error("[AUTH] User not found for decoded.id:", decoded.id);
      return errorHelper(res, null, "Unauthorized: User not found", 401);
    }

    // Check token version for forced logout
    if (decoded.tokenVersion !== undefined && user.tokenVersion !== decoded.tokenVersion) {
      return errorHelper(res, null, "Token has been revoked. Please login again.", 401);
    }

    if (user.status === "inactive") {
      return errorHelper(
        res,
        null,
        "Your account has been deactivated. Please contact support.",
        403,
      );
    }

    req.user = user;
    req.role = user.role;
    return next();
  } catch (error) {
    return errorHelper(
      res,
      error.message,
      "Unauthorized: Invalid or expired token",
      401,
    );
  }
};

const verifyUserOrAdmin = async (req, res, next) => {
  const token = getTokenFromHeader(req);
  if (!token) {
    return errorHelper(res, null, "Unauthorized: No token provided", 401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role === "admin") {
      const admin = await Admin.findById(decoded.id).select(
        "_id username email",
      );
      if (!admin) {
        return errorHelper(res, null, "Unauthorized: Admin not found", 401);
      }
      req.admin = admin;
      req.authType = "admin";
      return next();
    }

    if (decoded.role === "user" || decoded.role === "creator") {
      const user = await User.findById(decoded.id).select(
        "_id firstName lastName email role status isVerified",
      );
      if (!user) {
        return errorHelper(res, null, "Unauthorized: User not found", 401);
      }
      if (user.status === "inactive") {
        return errorHelper(
          res,
          null,
          "Your account has been deactivated. Please contact support.",
          403,
        );
      }
      req.user = user;
      req.role = user.role;
      req.authType = "user";
      return next();
    }

    return errorHelper(res, null, "Unauthorized: Invalid token role", 401);
  } catch (error) {
    return errorHelper(
      res,
      error.message,
      "Unauthorized: Invalid or expired token",
      401,
    );
  }
};

const optionalVerifyUser = async (req, res, next) => {
  const token = getTokenFromHeader(req);
  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role === "admin") {
      return next();
    }

    const user = await User.findById(decoded.id).select(
      "_id firstName lastName email role status isVerified",
    );
    if (!user || user.status === "inactive") {
      return next();
    }

    req.user = user;
    req.role = user.role;
    return next();
  } catch {
    return next();
  }
};

const verifyContentCreator = async (req, res, next) => {
  return verifyUser(req, res, () => {
    if (req.role !== "creator") {
      return errorHelper(
        res,
        null,
        "Forbidden: Only content creators can perform this action",
        403,
      );
    }
    return next();
  });
};

const verifyVerifiedContentCreator = async (req, res, next) => {
  return verifyContentCreator(req, res, () => {
    if (!req.user.isVerified) {
      return errorHelper(
        res,
        null,
        "Forbidden: Only verified content creators can perform this action",
        403,
      );
    }
    return next();
  });
};

module.exports = {
  verifyUser,
  verifyUserOrAdmin,
  optionalVerifyUser,
  verifyContentCreator,
  verifyVerifiedContentCreator,
};
