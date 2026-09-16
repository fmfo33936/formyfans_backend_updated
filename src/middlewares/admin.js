const jwt = require("jsonwebtoken");
const Admin = require("../models/admin");

const getTokenFromHeader = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.split(" ")[1];
};

const verifyAdmin = async (req, res, next) => {
  const token = getTokenFromHeader(req);
  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role && decoded.role !== "admin") {
      return res.status(403).json({
        message:
          "Admin access required. Login via POST and use Bearer adminToken on this endpoint.",
      });
    }

    const admin = await Admin.findById(decoded.id).select("_id username email");

    if (!admin) {
      return res.status(401).json({
        message:
          "Unauthorized: Admin not found. Use a token from POST, not a user login token.",
      });
    }

    req.admin = admin;
    return next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Unauthorized: Invalid or expired token" });
  }
};

module.exports = {
  verifyAdmin,
};
