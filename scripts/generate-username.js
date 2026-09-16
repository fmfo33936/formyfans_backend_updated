/**
 * Backfills username for users missing one.
 * Run: node scripts/generate-username.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/auth");
const { generateUniqueUsername } = require("../src/utils/helper");

const missingUsernameFilter = {
  $or: [
    { username: { $exists: false } },
    { username: null },
    { username: "" },
  ],
};

const run = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI or MONGO_URI is required");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  const users = await User.find()
    .select("_id firstName lastName email username")
    .sort({ createdAt: 1 });

  if (users.length === 0) {
    await mongoose.disconnect();
    return;
  }


  let updated = 0;
  let failed = 0;

  for (const user of users) {
    try {
      const username = await generateUniqueUsername(
        user.firstName,
        user.lastName,
        User,
      );

      await User.updateOne({ _id: user._id }, { $set: { username } });
      updated += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed for ${user.email} (${user._id}):`, error.message);
    }
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
