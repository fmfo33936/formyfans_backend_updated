const express = require("express");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { v4: uuidv4 } = require("uuid");
const s3Client = require("./s3.js");

const router = express.Router();

const ALLOWED_FOLDERS = ["media", "docs", "voice"];

router.post("/presigned-url", async (req, res) => {
  try {
    const { fileName, fileType, folder } = req.body;

    if (!fileName || !fileType || !folder) {
      return res.status(400).json({ message: "fileName, fileType and folder are required" });
    }

    if (!ALLOWED_FOLDERS.includes(folder)) {
      return res.status(400).json({ message: "Invalid folder. Allowed: media, docs, voice" });
    }

  
    const uniqueFileName = `${folder}/${uuidv4()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: uniqueFileName,
      ContentType: fileType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 60, // 60 seconds
    });

    res.status(200).json({
      presignedUrl,
      fileName: uniqueFileName,
    });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    res.status(500).json({ message: "Failed to generate presigned URL" });
  }
});

module.exports = router;