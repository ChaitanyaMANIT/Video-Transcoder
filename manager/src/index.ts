import 'dotenv/config';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs'
import type { S3Event } from 'aws-lambda';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const QUEUE_URL = process.env.SQS_QUEUE_URL || 'https://sqs.ap-south-1.amazonaws.com/911229171877/temp-raw-videos-S3-queue';
const ECS_CLUSTER = process.env.ECS_CLUSTER_ARN || 'arn:aws:ecs:ap-south-1:911229171877:cluster/test-cluster';
const ECS_TASK_DEFINITION = process.env.ECS_TASK_DEFINITION_ARN || 'arn:aws:ecs:ap-south-1:911229171877:task-definition/task-video-transcoder';

const sqsClient = new SQSClient({ region: REGION });
const ecsClient = new ECSClient({ region: REGION });

async function init() {
    const command = new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 5,
    })

    while (true) {
        const { Messages } = await sqsClient.send(command);

        if (!Messages) {
            console.log('No message found');
            continue;
        }

        try {

            for (const Message of Messages) {
                const { MessageId, Body } = Message;
                console.log('Message Received : ', { MessageId, Body });

                // Step 1 : Validate and Parse
                if (!Body) continue;
                const event = JSON.parse(Body) as S3Event

                if ('Service' in event && 'Event' in event) { // Ignores the test event from s3
                    if (event.Event === 's3:TestEvent') {
                        // Invalid Event => Delete it
                        await sqsClient.send(new DeleteMessageCommand({
                            QueueUrl: QUEUE_URL,
                            ReceiptHandle: Message.ReceiptHandle,
                        }));

                        console.log('Message deleted : ', MessageId);
                        continue;
                    }
                }

                for (const record of event.Records) {
                    const { s3 } = record;
                    const { bucket, object } = s3;
                    const key: string = object.key || "";

                    // Extract the videoId from the S3 key (e.g., "uploads/123-abc/original.mp4" -> "123-abc")
                    let videoId = "unknown";
                    if (key.startsWith("uploads/")) {
                        const parts = key.split('/');
                        if (parts.length >= 2 && parts[1]) {
                            videoId = parts[1];
                        }
                    }

                    const runTaskCommand = new RunTaskCommand({
                        taskDefinition: ECS_TASK_DEFINITION,
                        cluster: ECS_CLUSTER,
                        launchType: 'FARGATE',
                        networkConfiguration: {
                            awsvpcConfiguration: {
                                assignPublicIp: 'ENABLED',
                                securityGroups: ['sg-0a1e10ca9bcf54bd3'],
                                subnets: ['subnet-0d72f98aa0a7a98e6', 'subnet-027f1d73301702e25', 'subnet-0d4e4c1ba587a9a11']
                            }
                        },
                        overrides: {
                            containerOverrides: [
                                {
                                    name: 'video-transcoder-container',
                                    environment: [
                                        {
                                            name: 'BUCKET_NAME',
                                            value: bucket.name,
                                        },
                                        {
                                            name: 'KEY',
                                            value: key,
                                        },
                                        {
                                            name: 'VIDEO_ID',
                                            value: videoId
                                        },
                                        {
                                            name: 'API_BASE_URL',
                                            value: 'http://YOUR_BACKEND_PUBLIC_IP:3000'
                                        }
                                    ],
                                },
                            ],
                        }
                    });

                    await ecsClient.send(runTaskCommand);
                    await sqsClient.send(new DeleteMessageCommand({
                        QueueUrl: QUEUE_URL,
                        ReceiptHandle: Message.ReceiptHandle,
                    }));

                    console.log('Message deleted : ', MessageId);
                }
            }

        } catch (error) {
            console.log(error);
        }
    }
}

init();
