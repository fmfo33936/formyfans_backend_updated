const bcrypt = require("bcrypt");
const UserModel = require("../src/models/auth");
const { getStripe } = require("../src/utils/stripe");

const generateUsername = async (firstName, lastName) => {
  const base = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  let username = base;
  let counter = 1;

  while (await UserModel.exists({ username })) {
    username = `${base}${counter}`;
    counter++;
  }

  return username;
};

const bulkCreateInternalUsers = async (req, res) => {
  const usersData = [
    {
      fullName: "Timothy H",
      email: "timothy9092@yopmail.com",
      phoneNumber: "9788702345",
    },
  ];

  const SHARED_PASSWORD = "qwerty123";
  const IMAGE_URL =
    "https://res.cloudinary.com/dsvhzxotv/image/upload/v1785517243/images/xnkksicydbm8lc0x2j1c.jpg";
  const SHARED_DOB = new Date("2000-01-01");
  const SUBSCRIPTION_EXPIRES_AT = new Date("2049-12-30T19:00:00.000Z");
  const SUBSCRIPTION_ID = "6a4357d659cf0a419ff03d32";

  const results = {
    created: [],
    skipped: [],
    failed: [],
  };

  const hashedPassword = await bcrypt.hash(SHARED_PASSWORD, 10);

  for (const entry of usersData) {
    try {
      const normalizedEmail = entry.email.trim().toLowerCase();

      const existingUser = await UserModel.findOne({
        email: normalizedEmail,
      });

      if (existingUser) {
        results.skipped.push({
          email: normalizedEmail,
          reason: "Email already exists",
        });
        continue;
      }

      const [firstName, ...rest] = entry.fullName.trim().split(" ");
      const lastName = rest.join(" ") || firstName;

      const username = await generateUsername(firstName, lastName);

      const newUser = await UserModel.create({
        firstName,
        lastName,
        email: normalizedEmail,
        username,
        phoneNumber: entry.phoneNumber.trim(),
        password: hashedPassword,
        image: IMAGE_URL,
        coverImage: IMAGE_URL,
        tagLine: "Content creator",
        gender: "male",
        dob: SHARED_DOB,
        dateOfBirth: SHARED_DOB,
        isAdult: true,
        role: "creator",
        status: "active",
        accountType: "personal",
        isVerified: true,
        isPrivate: false,
        isDeleted: false,
        isInternalUser: true,
        activeSubscriptionId: SUBSCRIPTION_ID,
        activeSubscriptionExpiresAt: SUBSCRIPTION_EXPIRES_AT,
        location: {
          type: "Point",
          coordinates: [-106.5348379, 38.7945952],
          city: "",
          state: "",
          country: "United States",
        },
      });

      // Create Stripe customer
      const customer = await getStripe().customers.create({
        name: newUser.username,
        email: newUser.email,
        metadata: { userId: newUser._id.toString() },
      });

      newUser.stripeCustomerId = customer.id;
      await newUser.save();

      results.created.push({
        email: normalizedEmail,
        username,
        stripeCustomerId: customer.id,
      });
    } catch (error) {
      results.failed.push({
        email: entry.email,
        error: error.message,
      });
    }
  }

  const result = {
    totalRequested: usersData.length,
    created: results.created.length,
    skipped: results.skipped.length,
    failed: results.failed,
  };

};

module.exports = { bulkCreateInternalUsers };
