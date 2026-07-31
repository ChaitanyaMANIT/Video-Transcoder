# 🎬 Video Transcoder

A serverless, event-driven video transcoding platform that automatically converts uploaded videos into multiple resolutions (360p, 480p, 720p) using AWS services.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![React](https://img.shields.io/badge/React-18-blue)
![AWS](https://img.shields.io/badge/AWS-ECS%2C%20S3%2C%20SQS-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

---

## 🏗️ Architecture Overview

This project implements a **fully event-driven architecture** using AWS services to handle video processing asynchronously. When a user uploads a video, the system automatically triggers a pipeline that transcodes the video into multiple resolutions without any manual intervention.

### Event-Driven Flow

```
┌─────────────┐
│   User      │
│  Uploads    │
│   Video     │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React + Vite)                                    │
│  - Uploads directly to S3 via presigned URL                 │
│  - Polls backend every 3s for status updates                │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  S3 (Raw Videos Bucket)                                     │
│  - Stores original uploaded video                           │
│  - Triggers S3 Event Notification on upload                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ S3 Event Notification
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  SQS Queue                                                  │
│  - Decouples upload from processing                         │
│  - Buffers video processing jobs                            │
│  - Enables retry on failure                                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ Manager polls SQS (every 5s)
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  MANAGER (TypeScript - runs locally/EC2)                    │
│  - Long-polls SQS for new messages                          │
│  - Parses S3 event to extract bucket & key                  │
│  - Launches ECS Fargate task for each video                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ RunTaskCommand
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  AWS ECS (Fargate) - Worker                                 │
│  - Downloads original video from S3                         │
│  - Transcodes using FFmpeg into 3 resolutions               │
│  - Uploads transcoded files to destination bucket           │
│  - Notifies backend via webhook                             │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ POST /update-status
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  BACKEND (Express + Prisma + SQLite)                        │
│  - Serves presigned URLs for uploads                        │
│  - Stores video metadata in database                        │
│  - Receives status updates from worker                      │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ WebSocket/Polling
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React)                                           │
│  - Displays video list with real-time status                │
│  - Shows download buttons for transcoded files              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Features

- **Direct-to-S3 Upload**: Videos upload directly from browser to S3 using presigned URLs (no server bottleneck)
- **Event-Driven Processing**: S3 events trigger SQS messages, which trigger ECS tasks
- **Serverless Transcoding**: FFmpeg runs in Docker containers on AWS ECS Fargate
- **Multi-Resolution Output**: Automatically generates 360p, 480p, and 720p versions
- **Real-Time Status Updates**: Frontend polls backend every 3 seconds for status changes
- **Decoupled Architecture**: SQS queue buffers jobs, enabling retry logic and scaling
- **Presigned Download URLs**: Secure, time-limited download links for transcoded files

---

## 🛠️ Tech Stack

### Frontend
- **React 18** with Vite
- **Axios** for HTTP requests
- **CSS3** with glassmorphism design

### Backend
- **Node.js** + **Express**
- **Prisma ORM** with SQLite database
- **AWS SDK v3** for S3 operations
- **UUID** for unique video IDs

### Worker (Transcoding Service)
- **Node.js** with **Fluent-FFmpeg**
- **Docker** container with FFmpeg installed
- Deployed on **AWS ECS Fargate**

### Manager (Orchestrator)
- **TypeScript**
- **AWS SDK v3** for SQS and ECS
- Long-polling SQS queue for job dispatch

### AWS Services
- **S3**: Raw video storage + transcoded output storage
- **SQS**: Message queue for decoupled job processing
- **ECS Fargate**: Serverless container orchestration for transcoding
- **IAM**: Access management for AWS resources

---

## 📊 Database Schema

```prisma
model Video {
  id          String   @id @default(uuid())
  title       String
  originalKey String
  status      String   @default("Pending")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**Status Flow**: `Pending` → `Transcoding` → `Completed` (or `Failed`)

---

## 🔄 Event-Driven Pipeline

### 1. Upload Phase
1. User selects video in frontend
2. Frontend requests presigned upload URL from backend
3. Backend generates presigned S3 URL (valid 5 minutes)
4. Frontend uploads video **directly to S3** (progress tracked in real-time)
5. Frontend saves video metadata to database with status `Pending`

### 2. Event Trigger Phase
1. S3 detects new object upload
2. S3 sends event notification to **SQS Queue**
3. Message contains: bucket name, object key, event timestamp

### 3. Processing Phase
1. **Manager** (running on EC2/local) long-polls SQS (5-second wait time)
2. On message receipt, Manager:
   - Parses S3 event to extract video ID from S3 key
   - Launches ECS Fargate task with environment variables (bucket, key, videoId)
   - Deletes message from SQS
3. **ECS Worker** starts and:
   - Downloads original video from S3
   - Runs FFmpeg to transcode into 360p, 480p, 720p
   - Uploads transcoded files to destination bucket
   - Calls backend webhook to update status to `Completed`

### 4. Status Update Phase
1. Worker sends `POST /update-status` to backend
2. Backend updates database: `status = "Completed"`
3. Frontend polls backend every 3 seconds
4. UI automatically updates to show green "COMPLETED" badge

---

## 🎯 System Design & Architectural Trade-offs

This project was built with professional, production-grade microservices patterns. Below is an explanation of the core architectural decisions and trade-offs made:

### 1. Why SQS Queue instead of Direct ECS Task Launch?
* **Rate Limiting & Throttling Protection**: Launching an ECS task directly on every S3 upload could run into AWS API rate limits (e.g., `ecs:RunTask` limit of 20 operations per second by default in some regions). If 100 users uploaded files simultaneously, requests would be throttled and tasks dropped.
* **Buffer & Shock-Absorption**: Under spikes in traffic, SQS acts as a buffer. The messages safely sit in the queue until the manager polls and spins up workers within the allowed resource constraints.
* **Reliability & Retry Mechanism**: If a worker fails mid-process (e.g., networking hiccup), SQS visibility timeout will expire, and the message will automatically reappear in the queue for processing. If we used direct invocation, a failure would lose the processing request entirely.

### 2. Why Presigned URLs instead of Uploading to Backend Server First?
* **Eliminating Server Bottlenecks**: High-definition video files are huge. If the frontend sent files to our Express backend, the backend server would spend all its CPU, RAM, and network bandwidth simply receiving files. It would slow down or crash, affecting other users.
* **Cost Efficiency**: Uploading directly to S3 shifts 100% of the network load and memory consumption to AWS's massive infrastructure. Our backend Express server can run on a tiny, cheap instance (like a t3.nano) and remain highly responsive.
* **Security & Scope**: By using temporary presigned URLs, we avoid hardcoding AWS secret keys in the client browser, while restricting write access to just one specific file path for 5 minutes.

### 3. Why ECS Fargate instead of AWS Lambda for the Worker?
* **No Timeout Constraints**: AWS Lambda has a hard execution limit of **15 minutes**. Transcoding a long, high-bitrate video can easily take 30+ minutes, causing a Lambda to timeout. Fargate has no runtime limits.
* **Disk Space & Resource Limits**: Video processing requires downloading the original video and storing output files. Lambda ephemeral storage is limited (up to 10GB now, but expensive to scale), whereas ECS Fargate tasks can easily allocate up to 200GB of ephemeral storage.
* **CPU/Memory Flexibility**: Codecs like `libx264` are highly CPU-bound. ECS Fargate allows us to allocate precise virtual CPUs (vCPUs) and RAM tailored for heavy encoding pipelines, which is far more cost-effective for sustained execution.

---

## 💸 Cost Estimation at Scale (1,000 Videos/Day)

To demonstrate production awareness, here is a cost breakdown for running this pipeline at a moderate scale of **1,000 video uploads per day** (assuming average length 3 minutes, 100MB input file size, and 2 minutes of Fargate transcoding compute per video using `0.5 vCPU` and `1 GB RAM`).

### 1. AWS SQS (Message Queue)
* **Scale**: 1,000 uploads = ~1,000 SQS queue operations/day = 30,000 operations/month.
* **Cost**: **$0.00 / month** (First 1 million SQS requests/month are free under the AWS Free Tier).

### 2. AWS S3 (Storage & Transfer)
* **Upload Storage**: 1,000 videos * 100MB = 100 GB/day = 3 TB/month.
* **Output Storage**: 3 transcoded versions (360p, 480p, 720p) = ~80MB combined * 1000/day = 2.4 TB/month.
* **Cost**:
  * Storage (S3 Standard): 5.4 TB * $0.023/GB = **$124.20 / month**.
  * API Requests (PUT, GET): 30,000 PUTs + 30,000 GETs = **$0.20 / month**.

### 3. AWS ECS Fargate (Transcoding Compute)
* **Compute Specs**: 0.5 vCPU + 1.0 GB RAM per task.
* **Runtime**: 2 minutes per video * 1,000 videos/day = 2,000 minutes/day = 1,000 hours/month.
* **Cost** (ap-south-1 Pricing):
  * vCPU Cost: 1,000 hrs * 0.5 vCPU * $0.04048/vCPU-hr = $20.24/month.
  * RAM Cost: 1,000 hrs * 1 GB * $0.004445/GB-hr = $4.45/month.
  * Total Fargate Cost: **$24.69 / month**.

### 4. Data Transfer (Egress)
* S3 to Internet (Users downloading videos): Assuming 50% of transcoded videos are downloaded (1.2 TB/month egress).
* **Cost**: 1,200 GB * $0.09/GB = **$108.00 / month**.

### 📊 Monthly Running Total: ~$257.09
* *Note: Over 90% of the cost is storage and network data transfer (Egress). The actual event-driven serverless computing (SQS + Fargate) only costs **~$25/month**, showing the extreme efficiency of serverless compute.*

---

## 📦 Project Structure

```
VideoTranscoder/
├── backend/                 # Express API server
│   ├── index.js            # Main server with 4 API routes
│   ├── prisma/
│   │   └── schema.prisma   # Database schema
│   ├── .env                # AWS credentials & config
│   └── dev.db              # SQLite database
│
├── frontend/               # React application
│   ├── src/
│   │   ├── App.jsx         # Main component with upload & list
│   │   ├── main.jsx        # React entry point
│   │   └── index.css       # Styling
│   └── package.json
│
├── worker/                 # FFmpeg transcoding service
│   ├── index.js            # Downloads, transcodes, uploads
│   ├── Dockerfile          # Node 18 + FFmpeg
│   └── package.json
│
└── manager/                # SQS poller & ECS orchestrator
    ├── src/
    │   └── index.ts        # Long-polls SQS, launches ECS tasks
    └── package.json
```

---

## 🔌 API Endpoints

### Backend (Port 3000)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/get-upload-url` | Generate presigned S3 upload URL |
| `POST` | `/videos` | Save video metadata to database |
| `GET` | `/videos` | Fetch all videos (ordered by newest) |
| `POST` | `/update-status` | Webhook for worker to update transcoding status |

---

## 🚦 Getting Started

### Prerequisites
- Node.js 18+
- AWS Account with S3, SQS, ECS, and ECR configured
- FFmpeg (for local testing of worker)

### Installation

#### 1. Clone the repository
```bash
git clone https://github.com/ChaitanyaMANIT/Video-Transcoder.git
cd Video-Transcoder
```

#### 2. Backend Setup
```bash
cd backend
npm install
npx prisma generate
npx prisma db push

# Create .env file with:
# AWS_ACCESS_KEY_ID=your_key
# AWS_SECRET_ACCESS_KEY=your_secret
# AWS_REGION=ap-south-1
# RAW_BUCKET_NAME=your-raw-videos-bucket

npm start
```

#### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

#### 4. Manager Setup
```bash
cd manager
npm install

# Create .env file with:
# AWS_REGION=ap-south-1
# SQS_QUEUE_URL=your-sqs-queue-url
# ECS_CLUSTER_ARN=your-ecs-cluster-arn
# ECS_TASK_DEFINITION_ARN=your-task-definition-arn

npm run dev
```

#### 5. Worker Deployment (AWS ECS)
```bash
cd worker

# Build Docker image
docker build -t video-transcoder .

# Push to ECR
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-south-1.amazonaws.com
docker tag video-transcoder:latest <account>.dkr.ecr.ap-south-1.amazonaws.com/video-transcoder:latest
docker push <account>.dkr.ecr.ap-south-1.amazonaws.com/video-transcoder:latest

# Update ECS task definition with new image URI
# ECS will automatically pull and run the new image
```

---

## 🧪 Testing the Flow

1. **Start Backend**: `cd backend && npm start`
2. **Start Frontend**: `cd frontend && npm run dev`
3. **Start Manager**: `cd manager && npm run dev`
4. **Upload a video** via the frontend UI
5. **Watch the magic**:
   - Video uploads to S3 (progress bar shows 0-100%)
   - S3 event triggers SQS message
   - Manager picks up message and launches ECS task
   - Worker transcodes video into 3 resolutions
   - Transcoded files appear in destination S3 bucket
   - Backend status updates to "Completed"
   - Frontend shows green badge

---

## 🎓 Learning Outcomes

This project demonstrates:
- **Event-driven microservices architecture** on AWS
- **Serverless computing** with ECS Fargate
- **Message queue patterns** with SQS for decoupling
- **Presigned URL authentication** for secure file uploads/downloads
- **Real-time UI updates** via polling
- **Docker containerization** for consistent deployments
- **TypeScript** for type-safe infrastructure code
- **Prisma ORM** for database access

---

## 🔮 Future Improvements

- [ ] Add video player in frontend to preview transcoded files
- [ ] Store transcoded file paths in database
- [ ] Add download buttons for each resolution
- [ ] Implement WebSocket for real-time status (instead of polling)
- [ ] Add user authentication and video ownership
- [ ] Support for more video formats (MKV, AVI, MOV)
- [ ] Add thumbnail generation during transcoding
- [ ] Implement video compression options
- [ ] Add progress tracking for transcoding (not just upload)
- [ ] Deploy backend to AWS EC2/Elastic Beanstalk for production

---

## 📝 License

ISC

---

## 👨‍💻 Author

Built with ❤️ by Chaitanya Kulkarni

---

## 🙏 Acknowledgments

- AWS for providing robust serverless infrastructure
- FFmpeg for powerful video processing capabilities
- React and Vite communities for excellent tooling