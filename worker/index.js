import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import fs from 'node:fs/promises'
import path from 'node:path'
import ffmpeg from 'fluent-ffmpeg'

const BUCKET = process.env.BUCKET_NAME;
const KEY = process.env.KEY;
const VIDEO_ID = process.env.VIDEO_ID;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const RESOLUTIONS = [
    { name: "360p", width: 480, height: 360 },
    { name: "480p", width: 858, height: 480 },
    { name: "720p", width: 1280, height: 720 },
];

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1'
})


async function init() {
    const originalFilePath = 'original-video.mp4';
    try {
        if (!BUCKET || !KEY) {
            throw new Error('BUCKET_NAME or KEY environment variables are not set.');
        }

        console.log(`Downloading s3://${BUCKET}/${KEY} locally...`);

        // Download the original video locally
        const command = new GetObjectCommand({
            Bucket: BUCKET,
            Key: KEY,
        });

        const response = await s3Client.send(command);
        await fs.writeFile(originalFilePath, response.Body);
        console.log('Download complete. Starting transcoding resolutions...');

        // Start the transcoder
        const promises = RESOLUTIONS.map(resolution => {
            const output = `video-${resolution.name}.mp4`;

            return new Promise((resolve, reject) => {
                ffmpeg(originalFilePath)
                    .output(output)
                    .withVideoCodec('libx264')
                    .withAudioCodec('aac')
                    .withSize(`${resolution.width}x${resolution.height}`)
                    .on('end', async () => {
                        try {
                            const destBucket = process.env.DESTINATION_BUCKET || "transcoded-videos-cha.kulkarni";
                            console.log(`Uploading transcoded file ${output} to S3 bucket ${destBucket}...`);

                            const putCommand = new PutObjectCommand({
                                Bucket: destBucket,
                                Key: output,
                                Body: await fs.readFile(output)
                            });

                            await s3Client.send(putCommand);
                            console.log('Uploaded: ', output);

                            // Delete local transcoded file
                            await fs.unlink(output);
                            resolve(output);
                        } catch (uploadErr) {
                            console.error(`Error uploading or cleaning up ${output}:`, uploadErr);
                            reject(uploadErr);
                        }
                    })
                    .on('error', (err) => {
                        console.error(`Error transcoding to ${resolution.name}:`, err);
                        reject(err);
                    })
                    .format('mp4')
                    .run();
            });
        });

        await Promise.all(promises);
        console.log('All resolutions transcoded and uploaded successfully.');

        // Let the backend know the job is finished!
        if (VIDEO_ID) {
            try {
                await fetch(`${API_BASE_URL}/update-status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ videoId: VIDEO_ID, status: 'Completed' })
                });
                console.log('Backend notified of success!');
            } catch (err) {
                console.error('Failed to notify backend:', err);
            }
        }
    } catch (error) {
        console.error('Transcoding job failed:', error);

        // Let the backend know the job failed!
        if (VIDEO_ID) {
            try {
                await fetch(`${API_BASE_URL}/update-status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ videoId: VIDEO_ID, status: 'Failed' })
                });
                console.log('Backend notified of failure!');
            } catch (err) {
                console.error('Failed to notify backend:', err);
            }
        }

        process.exitCode = 1;
    } finally {
        // Clean up the original local video if it exists
        await fs.unlink(originalFilePath).catch(() => { });
    }
}

init().finally(() => process.exit(process.exitCode || 0));