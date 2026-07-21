import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

// Load our secret variables from the .env file
dotenv.config();

// Create our Express server and our Database client
const app = express();
const prisma = new PrismaClient();

// Create our S3 connection using our AWS keys
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  }
});

// "cors" allows our frontend (React) to talk to this backend without browser security errors
// "express.json" allows our backend to understand JSON data sent to it
app.use(cors());
app.use(express.json());


// ==========================================
// API ROUTE 1: Get an Upload VIP Pass
// ==========================================
// The frontend calls this before uploading a video to AWS.
app.get('/get-upload-url', async (req, res) => {
  try {
    // 1. Create a random, unique ID for the new video (like "123e4567-e89b-...")
    const videoId = uuidv4();
    
    // 2. Decide exactly what the file will be called in AWS S3
    const fileNameInS3 = `uploads/${videoId}/original.mp4`;

    // 3. Create an AWS command telling S3 "Someone is going to put a file here"
    const command = new PutObjectCommand({
      Bucket: process.env.RAW_BUCKET_NAME,
      Key: fileNameInS3,
    });

    // 4. Generate the "VIP Pass" (a temporary, secure URL valid for only 5 minutes)
    // This allows the browser to upload directly to S3 without passing through our server!
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    // 5. Send the unique ID and the secure URL back to the frontend
    res.json({
      videoId: videoId,
      uploadUrl: uploadUrl,
      originalKey: fileNameInS3
    });

  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});


// ==========================================
// API ROUTE 2: Save a New Video in the Database
// ==========================================
// The frontend calls this AFTER it finishes uploading the file to S3
app.post('/videos', async (req, res) => {
  try {
    const { videoId, title, originalKey } = req.body;

    // Save the video details into our SQLite database file
    const newVideo = await prisma.video.create({
      data: {
        id: videoId,
        title: title,
        originalKey: originalKey,
        status: "Pending" // Starts as Pending
      }
    });

    res.json(newVideo);
  } catch (error) {
    console.error("Error saving video:", error);
    res.status(500).json({ error: "Failed to save video" });
  }
});


// ==========================================
// API ROUTE 3: Get All Videos
// ==========================================
// The frontend calls this to show the list of videos
app.get('/videos', async (req, res) => {
  try {
    // Fetch all videos from the database, newest first
    const videos = await prisma.video.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(videos);
  } catch (error) {
    console.error("Error fetching videos:", error);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});


// ==========================================
// API ROUTE 4: Update Video Status (Webhook)
// ==========================================
// Our AWS ECS Worker calls this when it finishes transcoding
app.post('/update-status', async (req, res) => {
  try {
    const { videoId, status } = req.body;

    // Update the video's status in the database (e.g. to "Completed")
    const updatedVideo = await prisma.video.update({
      where: { id: videoId },
      data: { status: status }
    });

    res.json(updatedVideo);
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ error: "Failed to update status" });
  }
});


// ==========================================
// START THE SERVER
// ==========================================
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
