// scripts/migrateCloudinaryToS3Messages.js

const dns = require("dns");
dns.setServers(["1.1.1.1"]);

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.production") });

const mongoose = require("mongoose");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const { PutObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = require("../src/awsConfig/s3");
const Message = require("../src/models/message"); 

const migrateCloudinaryToS3Messages = async () => {
  try {
    console.log("Connecting to MongoDB...");

    await mongoose.connect(process.env.MONGODB_URI);

    console.log("MongoDB connected.");

    const messages = await Message.find({
      $or: [
        { "attachment.url": { $regex: /cloudinary\.com/i } },
        { "sharedPost.media.url": { $regex: /cloudinary\.com/i } },
        { "sharedCampaign.advertisement.media.url": { $regex: /cloudinary\.com/i } },
      ],
    }).limit(100);

    console.log(`Found ${messages.length} messages containing Cloudinary media.`);

    let totalFiles = 0;
    let migratedFiles = 0;
    let failedFiles = 0;

    const migrateSingleUrl = async (oldUrl, defaultType) => {
      console.log("\n-----------------------------------");
      console.log("Migrating:");
      console.log(oldUrl);

      const response = await axios.get(oldUrl, {
        responseType: "arraybuffer",
      });

      const buffer = Buffer.from(response.data);

      const parsedUrl = new URL(oldUrl);
      const pathname = parsedUrl.pathname;

      let fileName = path.basename(pathname);
      fileName = fileName.split("?")[0];
      fileName = fileName.replace(/\s+/g, "_");

      if (!fileName || !fileName.includes(".")) {
        const extension = defaultType === "video" ? "mp4" : "jpg";
        fileName = `migrated-file.${extension}`;
      }

      const uniqueFileName = `media/${uuidv4()}-${fileName}`;

      let contentType = response.headers["content-type"];
      if (!contentType) {
        contentType = defaultType === "video" ? "video/mp4" : "image/jpeg";
      }

      const command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: uniqueFileName,
        Body: buffer,
        ContentType: contentType,
      });

      await s3Client.send(command);

      console.log("S3 uploaded:");
      console.log(uniqueFileName);

      return uniqueFileName;
    };

    for (const msg of messages) {
      let msgChanged = false;

      // 1. attachment.url
      if (msg.attachment?.url && msg.attachment.url.includes("cloudinary.com")) {
        totalFiles++;
        try {
          const defaultType = msg.attachment.type === "audio" ? "audio" : "photo";
          const newFileName = await migrateSingleUrl(msg.attachment.url, defaultType);
          msg.attachment.url = newFileName;
          msgChanged = true;
          migratedFiles++;
        } catch (error) {
          failedFiles++;
          console.error("\nattachment.url migration failed:");
          console.error(msg.attachment.url);
          console.error(error.message);
        }
      }

      // 2. sharedPost.media.url
      if (msg.sharedPost?.media?.url && msg.sharedPost.media.url.includes("cloudinary.com")) {
        totalFiles++;
        try {
          const defaultType = msg.sharedPost.media.mediaType === "video" ? "video" : "photo";
          const newFileName = await migrateSingleUrl(msg.sharedPost.media.url, defaultType);
          msg.sharedPost.media.url = newFileName;
          msgChanged = true;
          migratedFiles++;
        } catch (error) {
          failedFiles++;
          console.error("\nsharedPost.media.url migration failed:");
          console.error(msg.sharedPost.media.url);
          console.error(error.message);
        }
      }

      // 3. sharedCampaign.advertisement.media (array)
      if (
        msg.sharedCampaign?.advertisement?.media &&
        msg.sharedCampaign.advertisement.media.length > 0
      ) {
        for (const mediaItem of msg.sharedCampaign.advertisement.media) {
          if (mediaItem.url && mediaItem.url.includes("cloudinary.com")) {
            totalFiles++;
            try {
              const defaultType = mediaItem.mediaType === "video" ? "video" : "photo";
              const newFileName = await migrateSingleUrl(mediaItem.url, defaultType);
              mediaItem.url = newFileName;
              msgChanged = true;
              migratedFiles++;
            } catch (error) {
              failedFiles++;
              console.error("\nsharedCampaign.advertisement.media migration failed:");
              console.error(mediaItem.url);
              console.error(error.message);
            }
          }
        }
      }

      if (msgChanged) {
        await msg.save();
        console.log(`Message ${msg._id} updated successfully.`);
      }
    }

    console.log("\n===================================");
    console.log("Migration Completed");
    console.log("===================================");

    console.log(`Total Cloudinary files: ${totalFiles}`);
    console.log(`Successfully migrated: ${migratedFiles}`);
    console.log(`Failed: ${failedFiles}`);
  } catch (error) {
    console.error("Migration error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB disconnected.");
  }
};

migrateCloudinaryToS3Messages();