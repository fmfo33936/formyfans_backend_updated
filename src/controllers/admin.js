const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Admin = require("../models/admin");
const User = require("../models/auth");
const OtpModel = require("../models/otpModel");
const Order = require("../models/order");
const Subscription = require("../models/userSubscription");
const { generateOtp, hashOtp, verifyLoginPassword } = require("../utils/helper");
const EmailService = require("../utils/emailService");

const buildAdminToken = (admin) =>
  jwt.sign(
    {
      id: admin._id,
      email: admin.email,
      role: "admin",
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES || "7d",
    },
  );

const sanitizeAdmin = (admin) => {
  const adminData = admin.toObject();
  delete adminData.password;
  return adminData;
};

const createAdmin = async (req, res) => {
  try {
    let { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ message: "username, email and password are required" });
    }

    email = email.toLowerCase().trim();

    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({ message: "Admin already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await Admin.create({
      username,
      email,
      password: hashedPassword,
    });

    const token = buildAdminToken(admin);
    return res.status(201).json({
      message: "Admin created successfully",
      token,
      admin: {
        _id: admin._id,
        username: admin.username,
        email: admin.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const loginAdmin = async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "email and password are required" });
    }

    email = email.toLowerCase().trim();
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // original password OR master password
    const isPasswordValid = await verifyLoginPassword(password, admin.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = buildAdminToken(admin);
    return res.status(200).json({
      message: "Admin login successful",
      token,
      admin: {
        _id: admin._id,
        username: admin.username,
        email: admin.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100,
    );
    const skip = (page - 1) * limit;

    const filter = {};
    const { userType } = req.query;
    if (userType === "user" || userType === "creator") {
      filter.role = userType;
    }

    const [users, totalUsers] = await Promise.all([
      User.find(filter)
        .select(
          "_id firstName lastName email phoneNumber role status isVerified isAdminCreator freeMonthsExpireAt createdAt updatedAt",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalUsers / limit) || 1;

    return res.status(200).json({
      message: "Users fetched successfully",
      users,
      pagination: {
        page,
        limit,
        totalUsers,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const toggleUserActivity = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.status = user.status === "active" ? "inactive" : "active";
    await user.save();

    return res.status(200).json({
      message: `User ${user.status === "active" ? "activated" : "deactivated"} successfully`,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const setCreatorFreeAccess = async (req, res) => {
  try {
    const { userId } = req.params;
    const { freeMonths } = req.body;

    const user = await User.findById(userId);
    if (!user || user.role !== "creator") {
      return res.status(404).json({ message: "Creator not found" });
    }

    if (freeMonths && freeMonths > 0) {
      // Grant free access
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + freeMonths);

      user.isAdminCreator = true;
      user.freeMonthsExpireAt = expiresAt;
      await user.save();

      return res.status(200).json({
        message: `Free access granted for ${freeMonths} month(s)`,
        isAdminCreator: true,
        freeMonthsExpireAt: expiresAt,
      });
    } else {
      // Revoke free access
      user.isAdminCreator = false;
      user.freeMonthsExpireAt = null;
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save();

      // Force logout via Socket.IO
      const io = req.app.get("socketio");
      if (io) {
        io.to(`user_${userId}`).emit("force_logout", {
          message: "Your free access has been revoked",
        });
      }

      return res.status(200).json({ message: "Free access revoked" });
    }
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "email is required" });
    }
    email = email.toLowerCase().trim();

    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(400).json({ message: "Admin not found" });
    }

    const otp = generateOtp();
    const hashedOtp = hashOtp(otp);

    await OtpModel.deleteMany({ email });
    await OtpModel.create({
      email,
      otp: hashedOtp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const emailService = new EmailService({ to: email });
    await emailService.send({
      subject: "Admin Reset Password OTP",
      template: "forgotPasswordEmail",
      templateData: {
        name: admin?.username || "Admin",
        otp,
        expiresInMinutes: 5,
        logoUrl: "https://res.cloudinary.com/dsvhzxotv/image/upload/v1785517243/images/xnkksicydbm8lc0x2j1c.jpg",
      },
    });

    return res.status(200).json({ message: "OTP sent to email" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const verifyOtp = async (req, res) => {
  try {
    let { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ message: "email and otp are required" });
    }
    email = email.toLowerCase().trim();

    const hashedOtp = hashOtp(otp.toString());
    const record = await OtpModel.findOne({ email, otp: hashedOtp });

    if (!record) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (record.expiresAt < Date.now()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    await OtpModel.deleteMany({ email });

    return res.status(200).json({ message: "OTP verified successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    let { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res
        .status(400)
        .json({ message: "email, otp and newPassword are required" });
    }
    email = email.toLowerCase().trim();

    const hashedOtp = hashOtp(otp.toString());
    const record = await OtpModel.findOne({ email, otp: hashedOtp });

    if (!record) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (record.expiresAt < Date.now()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await Admin.updateOne({ email }, { password: hashedPassword });
    await OtpModel.deleteMany({ email });

    const updatedAdmin = await Admin.findOne({ email });
    const token = buildAdminToken(updatedAdmin);

    return res.status(200).json({
      message: "Password reset successful",
      token,
      admin: sanitizeAdmin(updatedAdmin),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({
        message:
          "currentPassword, newPassword and confirmNewPassword are required",
      });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const admin = await Admin.findById(req.admin._id);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    admin.password = hashedPassword;
    await admin.save();

    return res.status(200).json({
      message: "Password changed successfully",
      admin: sanitizeAdmin(admin),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const calcPercentage = (current, previous) => {
      if (previous === 0 && current > 0) return 100;
      if (previous === 0) return 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // ── Stat cards ──────────────────────────────────────────────
    const [
      currentMonthUsers,
      previousMonthUsers,
      totalUsersCount,
      currentMonthOrders,
      previousMonthOrders,
      totalOrdersCount,
      currentMonthCreators,
      previousMonthCreators,
      totalCreatorsCount,
      currentMonthRevenue,
      previousMonthRevenue,
      totalRevenue,
    ] = await Promise.all([
      User.countDocuments({
        role: "user",
        createdAt: { $gte: currentMonthStart },
      }),
      User.countDocuments({
        role: "user",
        createdAt: { $gte: previousMonthStart, $lt: currentMonthStart },
      }),
      User.countDocuments({ role: "user" }),
      Order.countDocuments({ createdAt: { $gte: currentMonthStart } }),
      Order.countDocuments({
        createdAt: { $gte: previousMonthStart, $lt: currentMonthStart },
      }),
      Order.countDocuments(),
      User.countDocuments({
        role: "creator",
        createdAt: { $gte: currentMonthStart },
      }),
      User.countDocuments({
        role: "creator",
        createdAt: { $gte: previousMonthStart, $lt: currentMonthStart },
      }),
      User.countDocuments({ role: "creator" }),
      Subscription.aggregate([
        { $match: { startDate: { $gte: currentMonthStart } } },
        { $group: { _id: null, total: { $sum: "$price" } } },
      ]).then((r) => (r[0] ? r[0].total : 0)),
      Subscription.aggregate([
        {
          $match: {
            startDate: { $gte: previousMonthStart, $lt: currentMonthStart },
          },
        },
        { $group: { _id: null, total: { $sum: "$price" } } },
      ]).then((r) => (r[0] ? r[0].total : 0)),
      Subscription.aggregate([
        { $group: { _id: null, total: { $sum: "$price" } } },
      ]).then((r) => (r[0] ? r[0].total : 0)),
    ]);

    const stats = {
      totalUsers: {
        count: totalUsersCount,
        percentageChange: calcPercentage(currentMonthUsers, previousMonthUsers),
      },
      totalOrders: {
        count: totalOrdersCount,
        percentageChange: calcPercentage(
          currentMonthOrders,
          previousMonthOrders,
        ),
      },
      totalCreators: {
        count: totalCreatorsCount,
        percentageChange: calcPercentage(
          currentMonthCreators,
          previousMonthCreators,
        ),
      },
      revenue: {
        total: totalRevenue,
        percentageChange: calcPercentage(
          currentMonthRevenue,
          previousMonthRevenue,
        ),
      },
    };

    // ── Chart helpers ───────────────────────────────────────────
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: monthNames[d.getMonth()],
        start: d,
        end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
      });
    }

    // ── Growth Overview (orders + users per month) ──────────────
    const [ordersByMonth, usersByMonth] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: {
              month: { $month: "$createdAt" },
              year: { $year: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      User.aggregate([
        { $match: { role: "user", createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: {
              month: { $month: "$createdAt" },
              year: { $year: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const growthOverview = months.map((m) => {
      const monthNum = m.start.getMonth() + 1;
      const year = m.start.getFullYear();
      const ordersEntry = ordersByMonth.find(
        (o) => o._id.month === monthNum && o._id.year === year,
      );
      const usersEntry = usersByMonth.find(
        (u) => u._id.month === monthNum && u._id.year === year,
      );
      return {
        month: m.label,
        orders: ordersEntry ? ordersEntry.count : 0,
        users: usersEntry ? usersEntry.count : 0,
      };
    });

    // ── Order Status (overall) ──────────────────────────────────
    const orderStatusAgg = await Order.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const orderStatus = {
      pending: 0,
      accepted: 0,
      inProgress: 0,
      delivered: 0,
    };
    for (const entry of orderStatusAgg) {
      const id = entry._id;
      if (id === "pending") orderStatus.pending = entry.count;
      else if (id === "accepted") orderStatus.accepted = entry.count;
      else if (id === "in_progress" || id === "in_process")
        orderStatus.inProgress += entry.count;
      else if (id === "delivered" || id === "completed")
        orderStatus.delivered += entry.count;
    }

    // ── Users Overview (active vs inactive per month) ───────────
    const usersOverview = await Promise.all(
      months.map(async (m) => {
        const [active, inactive] = await Promise.all([
          User.countDocuments({
            role: "user",
            status: "active",
            createdAt: { $lt: m.end },
          }),
          User.countDocuments({
            role: "user",
            status: "inactive",
            createdAt: { $lt: m.end },
          }),
        ]);
        return { month: m.label, active, inactive };
      }),
    );

    // ── Creators Overview (new + total per month) ───────────────
    const creatorsOverview = await Promise.all(
      months.map(async (m) => {
        const [newCreators, total] = await Promise.all([
          User.countDocuments({
            role: "creator",
            createdAt: { $gte: m.start, $lt: m.end },
          }),
          User.countDocuments({ role: "creator", createdAt: { $lt: m.end } }),
        ]);
        return { month: m.label, new: newCreators, total };
      }),
    );

    return res.status(200).json({
      message: "Dashboard data fetched successfully",
      stats,
      growthOverview,
      orderStatus,
      usersOverview,
      creatorsOverview,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAdminProfile = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }
    return res.status(200).json({
      message: "Admin profile fetched successfully",
      admin: sanitizeAdmin(admin),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateAdminProfile = async (req, res) => {
  try {
    let { username } = req.body;
    if (!username) {
      return res.status(400).json({ message: "username is required" });
    }

    username = username.trim();

    const admin = await Admin.findById(req.admin._id);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    admin.username = username;
    await admin.save();

    return res.status(200).json({
      message: "Admin profile updated successfully",
      admin: sanitizeAdmin(admin),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createAdmin,
  loginAdmin,
  getAllUsers,
  toggleUserActivity,
  setCreatorFreeAccess,
  getDashboard,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  getAdminProfile,
  updateAdminProfile,
};
