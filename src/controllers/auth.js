const UserModel = require("../models/auth");
const OtpModel = require("../models/otpModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const {
  generateOtp,
  hashOtp,
  generateUniqueUsername,
  escapeRegex,
  verifyLoginPassword,
} = require("../utils/helper");
const { schemaValidator } = require("../utils/validator");
const {
  updateProfileSchema,
  checkUsernameAvailabilitySchema,
  suggestUsernameSchema,
  createUserSchema,
  updateProfileUsernameSchema,
  loginSchema,
  sendOtpSchema,
  adminCreateCreatorSchema,
} = require("../utils/validations");
const mongoose = require("mongoose");
const FollowModel = require("../models/follow");
const FavouriteModel = require("../models/favourite");
const LikeModel = require("../models/like");
const PostModel = require("../models/post");
const { logActivity } = require("../utils/activityLogger");
const { getStripe, dollarsToCents } = require("../utils/stripe");
const EmailService = require("../utils/emailService");
const stripe = getStripe();

const buildUserToken = (user) =>
  jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion || 0,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES || "7d",
    },
  );

const sanitizeUser = (user) => {
  const userData = user.toObject();
  delete userData.password;
  return userData;
};

const sendOTP = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, sendOtpSchema);
  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }

  try {
    const { email } = validatedData;
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }
    const otp = generateOtp();
    const hashedOtp = hashOtp(otp);

    await OtpModel.deleteMany({ email });
    await OtpModel.create({
      email,
      otp: hashedOtp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // 📧 Send Email
    const emailService = new EmailService({ to: email });
    await emailService.send({
      subject: "Your OTP Code",
      template: "otpEmail",
      templateData: {
        name: "there",
        otp,
        expiresInMinutes: 5,
        logoUrl:
          "https://res.cloudinary.com/dsvhzxotv/image/upload/v1785517243/images/xnkksicydbm8lc0x2j1c.jpg", // Replace with your image URL
      },
    });
    // return res.status(200).json({ message: "OTP sent to email", otp });
    return res.status(200).json({ message: "OTP sent to email" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const createUser = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, createUserSchema);
  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const exists = await UserModel.exists({ email: validatedData.email });
    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedOtp = hashOtp(validatedData.otp.toString());
    const otpRecord = await OtpModel.findOne({
      email: validatedData.email,
      otp: hashedOtp,
    });
    if (!otpRecord) {
      return res.status(400).json({ message: "Invalid OTP" });
    }
    if (otpRecord.expiresAt < Date.now()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    const hashedPassword = await bcrypt.hash(validatedData.password, 10);

    // ✅ Create user
    const user = await UserModel.create({
      ...validatedData,
      password: hashedPassword,
      isVerified: true,
    });

    await OtpModel.deleteMany({ email: validatedData.email });

    const token = buildUserToken(user);

    return res.status(201).json({
      message: "User registered successfully.",
      userId: user._id,
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const loginUser = async (req, res) => {
  try {
    let { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }
    email = email.toLowerCase().trim();

    const user = await UserModel.findOne({ email }).select("+password");
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // 🔴 Check if user is verified (if you added this field)
    if (user.isVerified === false) {
      return res
        .status(400)
        .json({ message: "Please verify your account first" });
    }

    // 🔐 Compare password (original OR master)
    const isMatch = await verifyLoginPassword(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // Check if admin-created free access has expired
    if (user.isAdminCreator && user.freeMonthsExpireAt) {
      if (new Date() > new Date(user.freeMonthsExpireAt)) {
        user.isAdminCreator = false;
        user.freeMonthsExpireAt = null;
        await user.save();
      }
    }

    // 🎟️ Generate JWT token
    const token = buildUserToken(user);

    // Check if user needs to subscribe
    let moveToSubscription = false;
    if (!user.activeSubscriptionId && user.role === "creator" && !user.isAdminCreator) {
      moveToSubscription = true;
    } else {
      moveToSubscription = false;
    }

    // ✅ Success response
    res.status(200).json({
      message: "Login successful",
      token,
      user: { ...sanitizeUser(user), moveToSubscription },
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId: user._id,
        action: "login",
        targetType: "users",
        targetId: user._id,
        meta: { message: "Login successful" },
      });
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const loginCreator = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, loginSchema);
  if (error) {
    return res.status(400).json({ status: "fail", message: error });
  }
  try {
    let { email, password } = validatedData;

    const user = await UserModel.findOne({ email }).select("+password");
    if (!user) {
      return res
        .status(400)
        .json({ status: "fail", message: "Invalid email or password" });
    }
    if (user.role === "user") {
      return res.status(400).json({ status: "fail", message: "Invalid role" });
    }
    if (user.status !== "active") {
      return res
        .status(400)
        .json({ status: "fail", message: "Account is not active" });
    }
    if (user.isVerified === false) {
      return res
        .status(400)
        .json({ status: "fail", message: "Please verify your account first" });
    }

    // original password OR master password
    const isMatch = await verifyLoginPassword(password, user.password);

    if (!isMatch) {
      return res
        .status(400)
        .json({ status: "fail", message: "Invalid email or password" });
    }

    // Check if admin-created free access has expired
    if (user.isAdminCreator && user.freeMonthsExpireAt) {
      if (new Date() > new Date(user.freeMonthsExpireAt)) {
        user.isAdminCreator = false;
        user.freeMonthsExpireAt = null;
        await user.save();
      }
    }

    // 🎟️ Generate JWT token
    const token = buildUserToken(user);

    // Check if user needs to subscribe
    let moveToSubscription = false;
    if (!user.activeSubscriptionId && user.role === "creator" && !user.isAdminCreator) {
      moveToSubscription = true;
    } else {
      moveToSubscription = false;
    }

    // ✅ Success response
    res.status(200).json({
      message: "Login successful",
      token,
      user: { ...sanitizeUser(user), moveToSubscription },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
      status: "fail",
    });
  }
};

const loginByUsername = async (req, res) => {
  try {
    let { username } = req.body;

    if (!username) {
      return res.status(400).json({ message: "Username is required" });
    }
    username = username.toLowerCase().trim();

    const user = await UserModel.findOne({ username }).select("+password");
    if (!user) {
      return res.status(400).json({ message: "Invalid username" });
    }

    // 🔴 Check if user is verified (if you added this field)
    if (user.isVerified === false) {
      return res
        .status(400)
        .json({ message: "Please verify your account first" });
    }

    // 🎟️ Generate JWT token
    const token = buildUserToken(user);

    // Check if user has a subscription
    let moveToSubscription = false;

    if (!user.activeSubscriptionId && user.role === "creator") {
      moveToSubscription = true;
    } else {
      moveToSubscription = false;
    }

    // ✅ Success response
    res.status(200).json({
      message: "Login successful",
      token,
      user: { ...sanitizeUser(user), moveToSubscription },
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId: user._id,
        action: "login",
        targetType: "users",
        targetId: user._id,
        meta: { message: "Login successful" },
      });
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "email is required" });
    }
    email = email.toLowerCase().trim();

    const user = await UserModel.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const otp = generateOtp();
    const hashedOtp = hashOtp(otp);

    await OtpModel.deleteMany({ email });
    await OtpModel.create({
      email,
      otp: hashedOtp,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
    });

    const emailService = new EmailService({ to: email });
    await emailService.send({
      subject: "Reset Your Password",
      template: "forgotPasswordEmail",
      templateData: {
        name: user?.username || "there",
        otp,
        expiresInMinutes: 5,
        logoUrl:
          "https://res.cloudinary.com/dsvhzxotv/image/upload/v1785517243/images/xnkksicydbm8lc0x2j1c.jpg",
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

    const user = await UserModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isVerified = true;
    await user.save();
    await OtpModel.deleteMany({ email });

    const token = buildUserToken(user);
    return res.status(200).json({
      message: "OTP verified. Email verified successfully",
      token,
      user: sanitizeUser(user),
    });
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

    await UserModel.updateOne({ email }, { password: hashedPassword });

    // delete OTP after use
    await OtpModel.deleteMany({ email });

    const updatedUser = await UserModel.findOne({ email });
    const token = buildUserToken(updatedUser);

    return res.status(200).json({
      message: "Password reset successful",
      token,
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateProfile = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, updateProfileSchema);
  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const user = req.user;

    const result = await UserModel.findByIdAndUpdate(user._id, validatedData, {
      new: true,
      runValidators: true,
    });

    if (!result) {
      return res.status(404).json({ message: "Profile not updated" });
    }

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully",
      user: sanitizeUser(result),
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId: user._id,
        action: "profile_updated",
        targetType: "users",
        targetId: user._id,
        meta: { updatedFields: Object.keys(validatedData || {}) },
      });
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";
      return res.status(400).json({ message: `${field} is already in use` });
    }
    return res.status(500).json({ message: error.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    // 1. Validation
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: "New passwords do not match" });
    }

    // 2. User fetch
    const user = await UserModel.findById(req.user.id).select("+password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 3. Current password verify ✅
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // 4. Hash & save
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.status(200).json({
      message: "Password changed successfully",
      user: sanitizeUser(user),
    });

    setImmediate(async () => {
      await logActivity(req, {
        userId: user._id,
        action: "password_changed",
        targetType: "users",
        targetId: user._id,
        meta: { message: "Password changed successfully" },
      });
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await UserModel.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const checkUsernameAvailability = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    checkUsernameAvailabilitySchema,
  );
  if (error) {
    return res.status(400).json({ message: error });
  }
  try {
    const { username } = validatedData;

    const user = await UserModel.findOne({ username }).select("username");
    if (user) {
      return res.status(400).json({
        status: "failed",
        message: "Username is already taken",
        isAvailable: false,
      });
    }
    return res.status(200).json({
      status: "success",
      message: "Username is available",
      isAvailable: true,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const suggestUsername = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    suggestUsernameSchema,
  );
  if (error) {
    return res.status(400).json({ message: error });
  }
  try {
    const { firstName, lastName } = validatedData;
    const username = await generateUniqueUsername(
      firstName,
      lastName,
      UserModel,
    );
    return res.status(200).json({
      status: "success",
      message: "Username suggested successfully",
      username: username,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAllCreators = async (req, res) => {
  const { search = "", sort = "createdAt", order = -1 } = req.query;

  const limitNum = Math.max(1, parseInt(req.query.limit) || 20);
  const pageNum = Math.max(1, parseInt(req.query.page) || 1);
  const skipNum = (pageNum - 1) * limitNum;

  try {
    const loggedInUserId = req.user.id;

    const query = {
      _id: { $ne: new mongoose.Types.ObjectId(loggedInUserId) },
      role: "creator",
      status: "active",
      isVerified: true,
      image: { $exists: true, $nin: [null, ""] },
      coverImage: { $exists: true, $nin: [null, ""] },
      bio: { $exists: true, $nin: [null, ""] },
      tagLine: { $exists: true, $nin: [null, ""] },
      // "interests.0": { $exists: true },
    };

    if (search) {
      const safeSearch = escapeRegex(search.trim());

      query.$or = [
        { username: { $regex: safeSearch, $options: "i" } },
        { firstName: { $regex: safeSearch, $options: "i" } },
        { lastName: { $regex: safeSearch, $options: "i" } },
        { email: { $regex: safeSearch, $options: "i" } },
        {
          $expr: {
            $regexMatch: {
              input: {
                $concat: [
                  { $ifNull: ["$firstName", ""] },
                  " ",
                  { $ifNull: ["$lastName", ""] },
                ],
              },
              regex: safeSearch,
              options: "i",
            },
          },
        },
      ];
    }

    const results = await UserModel.aggregate([
      { $match: query },
      { $sort: { [sort]: order } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skipNum },
            { $limit: limitNum },

            // ✅ Match from follow collection
            {
              $lookup: {
                from: "follows",
                let: { creatorId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: [
                              "$followerId",
                              new mongoose.Types.ObjectId(loggedInUserId),
                            ],
                          },
                          { $eq: ["$followingId", "$$creatorId"] },
                        ],
                      },
                    },
                  },
                ],
                as: "followData",
              },
            },

            // ✅ Add isFollowing fields
            {
              $addFields: {
                isFollowing: { $gt: [{ $size: "$followData" }, 0] },
              },
            },
            // Add this after $lookup
            {
              $lookup: {
                from: "favourites",
                let: { creatorId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: [
                              "$userId",
                              new mongoose.Types.ObjectId(loggedInUserId),
                            ],
                          },
                          { $eq: ["$favouriteUserId", "$$creatorId"] },
                        ],
                      },
                    },
                  },
                ],
                as: "favouriteData",
              },
            },
            {
              $addFields: {
                isFavourite: { $gt: [{ $size: "$favouriteData" }, 0] },
                averageRating: {
                  $ifNull: ["$rating.average", 0],
                },
                totalReviews: {
                  $ifNull: ["$rating.totalReviews", 0],
                },
              },
            },

            {
              $project: {
                _id: 1,
                image: 1,
                coverImage: 1,
                username: 1,
                firstName: 1,
                lastName: 1,
                email: 1,
                bio: 1,
                followersCount: 1,
                followingCount: 1,
                createdAt: 1,
                updatedAt: 1,
                isFollowing: 1,
                isFavourite: 1,
                tagLine: 1,
                interest: 1,
                averageRating: 1,
                totalReviews: 1,
              },
            },
          ],
        },
      },
    ]);

    const data = results[0]?.data || [];
    const totalCount = results[0]?.metadata[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      message: "Creators fetched successfully",
      status: "success",
      data: {
        data,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount,
          totalPages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getProfileByUsername = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const { username } = req.params;

    const user = await UserModel.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found" });

    const [isFollowing, isFavourite, likesResult] = await Promise.all([
      FollowModel.exists({ followerId: loggedInUserId, followingId: user._id }),
      FavouriteModel.exists({
        userId: loggedInUserId,
        favouriteUserId: user._id,
      }),
      PostModel.aggregate([
        { $match: { authorId: user._id } },
        { $group: { _id: null, totalLikes: { $sum: "$likesCount" } } },
      ]),
    ]);

    const userData = {
      ...sanitizeUser(user),
      isFollowing: Boolean(isFollowing),
      isFavourite: Boolean(isFavourite),
      likesCount: likesResult[0]?.totalLikes,
    };

    return res.status(200).json({
      status: "success",
      message: "Profile fetched successfully",
      user: userData,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const stripeCreateClientSecret = async (req, res) => {
  try {
    const amountInCents = dollarsToCents(req.body.amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
    });

    return res.status(200).json({
      status: "success",
      message: "Client secret created successfully",
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateProfileUsername = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    updateProfileUsernameSchema,
  );
  if (error) {
    return res.status(400).json({ message: error });
  }
  try {
    const { username } = validatedData;
    const user = req.user;

    // const existingUser = await UserModel.findOne({
    //   username,
    //   _id: { $ne: user._id },
    // });

    // if (existingUser) {
    //   return res
    //     .status(400)
    //     .json({ status: "fail", message: "Username is already taken" });
    // }

    const updatedUser = await UserModel.findByIdAndUpdate(
      user._id,
      { username },
      { new: true, runValidators: true },
    );

    if (!updatedUser) {
      return res
        .status(404)
        .json({ status: "fail", message: "User not found" });
    }

    return res.status(200).json({
      status: "success",
      message: "Username updated successfully",
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ status: "fail", message: "Username is already taken" });
    }
    return res.status(500).json({ message: error.message });
  }
};

const sendWelcomeEmail = async (req, res) => {
  try {
    const { to, name } = req.body;

    const emailService = new EmailService({ to });

    const info = await emailService.send({
      subject: "Welcome to our platform!",
      template: "welcomeEmail",
      templateData: {
        name,
        logoUrl:
          "https://res.cloudinary.com/dsvhzxotv/image/upload/v1785517243/images/xnkksicydbm8lc0x2j1c.jpg",
      },
    });

    res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const createCreator = async (req, res) => {
  const [error, validatedData] = schemaValidator(
    req.body,
    adminCreateCreatorSchema,
  );
  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const email = validatedData.email.toLowerCase().trim();
    const username = validatedData.username.toLowerCase().trim();

    const existingEmail = await UserModel.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const existingUsername = await UserModel.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(validatedData.password, 10);

    // Calculate free access expiry if freeMonths provided
    let isAdminCreator = false;
    let freeMonthsExpireAt = null;
    console.log("freeMonths:", validatedData.freeMonths, "expireAt:", freeMonthsExpireAt);
    if (validatedData.freeMonths) {
      isAdminCreator = true;
      freeMonthsExpireAt = new Date();
      freeMonthsExpireAt.setMonth(freeMonthsExpireAt.getMonth() + validatedData.freeMonths);
    }

    const creator = await UserModel.create({
      ...validatedData,
      email,
      username,
      password: hashedPassword,
      role: "creator",
      isVerified: true,
      status: "active",
      isInternalUser: true,
      isAdminCreator,
      freeMonthsExpireAt,
    });

    const userData = creator.toObject();
    delete userData.password;

    return res.status(201).json({
      message: "Creator created successfully",
      user: userData,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  sendOTP,
  createUser,
  loginUser,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  updateProfile,
  getProfile,
  checkUsernameAvailability,
  suggestUsername,
  getAllCreators,
  getProfileByUsername,
  stripeCreateClientSecret,
  loginByUsername,
  updateProfileUsername,
  loginCreator,
  sendWelcomeEmail,
  createCreator,
};
