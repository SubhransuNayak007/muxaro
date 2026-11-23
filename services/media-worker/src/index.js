const Fastify = require('fastify');
const { Queue, Worker, QueueEvents } = require('bullmq');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const fastify = Fastify({ logger: true });

// Environment Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_BUCKET = process.env.S3_BUCKET_ARTIFACTS || 'muxaro-artifacts';
const PRESIGNED_TTL = parseInt(process.env.S3_PRESIGNED_TTL_SECONDS || '3600', 10);

// Initialize S3 / Cloudflare R2 client
const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: true,
});

// Redis Queue Connection
const connection = { url: REDIS_URL };
const mediaQueue = new Queue('media-processing', { connection });
const queueEvents = new QueueEvents('media-processing', { connection });

// In-memory Job State registry for SSE streaming
const jobSubscribers = new Map();

function broadcastJobEvent(jobId, data) {
  const subscribers = jobSubscribers.get(jobId);
  if (subscribers) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of subscribers) {
      res.raw.write(message);
    }
  }
}

// ----------------------------------------------------------------------------
// 1. Dedicated BullMQ Worker: Stream Copy (-c copy) & Faststart
// ----------------------------------------------------------------------------
const worker = new Worker(
  'media-processing',
  async (job) => {
    const { url, format, quality } = job.data;
    const jobId = job.id;

    broadcastJobEvent(jobId, {
      status: 'PROBING',
      progress: 10,
      stage: 'Probing media formats and metadata…',
    });

    // Output filename
    const safeFilename = `muxaro_${jobId}.${format || 'mp4'}`;
    const tempOutputDir = process.env.TEMP_DIR || '/app/temp';
    const tempOutputPath = path.join(tempOutputDir, safeFilename);

    if (!fs.existsSync(tempOutputDir)) {
      fs.mkdirSync(tempOutputDir, { recursive: true });
    }

    broadcastJobEvent(jobId, {
      status: 'EXTRACTING',
      progress: 30,
      stage: 'Extracting upstream audio/video streams…',
    });

    // Execute yt-dlp + FFmpeg stream copy pipeline
    await new Promise((resolve, reject) => {
      // Stream muxing: -c copy ensures zero transcoding loss & maximum throughput
      const args = [
        '-f',
        quality === 'audio-only' ? 'ba/b' : 'bv*+ba/b',
        '--merge-output-format',
        format || 'mp4',
        '--postprocessor-args',
        'ffmpeg:-c copy -movflags +faststart',
        '-o',
        tempOutputPath,
        url,
      ];

      const child = spawn('yt-dlp', args);

      child.stderr.on('data', (data) => {
        const text = data.toString();
        // Extract progress percentage from yt-dlp stdout/stderr
        const match = text.match(/(\d+(?:\.\d+)?)%/);
        if (match) {
          const pct = Math.min(90, Math.max(30, Math.round(parseFloat(match[1]))));
          broadcastJobEvent(jobId, {
            status: 'REMUXING',
            progress: pct,
            stage: `Remuxing stream without quality loss (${pct}%)…`,
          });
        }
      });

      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with status code ${code}`));
      });
    });

    broadcastJobEvent(jobId, {
      status: 'PACKAGING',
      progress: 92,
      stage: 'Uploading to Cloudflare R2 with 60-min TTL…',
    });

    let downloadUrl = `/api/jobs/${jobId}/download`;

    // Upload to S3 / Cloudflare R2 if configured
    if (process.env.S3_ACCESS_KEY_ID && fs.existsSync(tempOutputPath)) {
      const fileStream = fs.createReadStream(tempOutputPath);
      const s3Key = `artifacts/${jobId}/${safeFilename}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: fileStream,
          ContentType: format === 'mp3' ? 'audio/mpeg' : 'video/mp4',
        })
      );

      // Generate Presigned Download URL with 60-minute expiration
      const getCmd = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
      });
      downloadUrl = await getSignedUrl(s3, getCmd, { expiresIn: PRESIGNED_TTL });

      // Clean up local temp file after upload
      fs.unlinkSync(tempOutputPath);
    }

    broadcastJobEvent(jobId, {
      status: 'READY',
      progress: 100,
      stage: 'Processing complete! File is ready.',
      downloadUrl,
      filename: safeFilename,
    });

    return { downloadUrl, safeFilename };
  },
  { connection, concurrency: parseInt(process.env.BULLMQ_CONCURRENCY || '10', 10) }
);

worker.on('failed', (job, err) => {
  broadcastJobEvent(job.id, {
    status: 'FAILED',
    progress: 0,
    error: {
      code: 'HOST_RESTRICTED_OR_STREAM_ERROR',
      message: err.message,
    },
  });
});

// ----------------------------------------------------------------------------
// 2. REST & SSE Gateway Routes
// ----------------------------------------------------------------------------

// Healthcheck
fastify.get('/health', async () => ({ status: 'ok', worker: 'muxaro-media-worker' }));

// Submit Job: POST /api/jobs -> { jobId }
fastify.post('/api/jobs', async (req, reply) => {
  const { url, format, quality } = req.body || {};
  if (!url) {
    return reply.status(400).send({ error: 'url is required' });
  }

  const job = await mediaQueue.add('process', { url, format, quality });
  return { jobId: job.id, status: 'QUEUED' };
});

// Server-Sent Events (SSE): GET /api/jobs/:id/events
fastify.get('/api/jobs/:id/events', (req, reply) => {
  const { id } = req.params;

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no');

  if (!jobSubscribers.has(id)) {
    jobSubscribers.set(id, new Set());
  }
  jobSubscribers.get(id).add(reply);

  // Send initial connected frame
  reply.raw.write(`data: ${JSON.stringify({ status: 'CONNECTED', jobId: id })}\n\n`);

  req.raw.on('close', () => {
    const subs = jobSubscribers.get(id);
    if (subs) {
      subs.delete(reply);
      if (subs.size === 0) jobSubscribers.delete(id);
    }
  });
});

// Direct Download Streaming: GET /api/jobs/:id/download
fastify.get('/api/jobs/:id/download', async (req, reply) => {
  const { id } = req.params;
  const tempOutputDir = process.env.TEMP_DIR || '/app/temp';
  const files = fs.existsSync(tempOutputDir) ? fs.readdirSync(tempOutputDir) : [];
  const matched = files.find((f) => f.startsWith(`muxaro_${id}`));

  if (!matched) {
    return reply.status(404).send({ error: 'File not found or expired from 60-min window' });
  }

  const filePath = path.join(tempOutputDir, matched);
  const stat = fs.statSync(filePath);

  reply.header('Content-Disposition', `attachment; filename="${matched}"`);
  reply.header('Content-Type', matched.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4');
  reply.header('Content-Length', stat.size);
  reply.header('Accept-Ranges', 'bytes');

  return reply.send(fs.createReadStream(filePath));
});

// Start Server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '5001', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Media Worker listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
