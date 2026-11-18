/**
 * MUXARO Media Processing Engine - Fastify Microservice Server
 * Provides REST and health check endpoints for media processing worker instances.
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MediaWorkerService } from './service.js';

const PORT = parseInt(process.env.PORT || '3002', 10);
const HOST = process.env.HOST || '0.0.0.0';

export function createServer(service?: MediaWorkerService): FastifyInstance {
  const server = Fastify({
    logger: true,
    genReqId: () => `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  });

  const workerService = service || new MediaWorkerService();

  // Helper envelopes
  const sendSuccess = (reply: FastifyReply, data: unknown, req: FastifyRequest) => {
    return reply.status(200).send({
      success: true,
      data,
      requestId: req.id
    });
  };

  const sendError = (reply: FastifyReply, statusCode: number, code: string, message: string, req: FastifyRequest) => {
    return reply.status(statusCode).send({
      success: false,
      error: {
        code,
        message
      },
      requestId: req.id
    });
  };

  // Health check
  server.get('/health', async (req, reply) => {
    try {
      const health = await workerService.getHealth();
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
      return reply.status(statusCode).send(health);
    } catch (err) {
      return reply.status(500).send({
        status: 'unhealthy',
        error: (err as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Probe media
  const probeSchema = z.object({
    inputPath: z.string().min(1)
  });

  server.post('/api/probe', async (req, reply) => {
    const parse = probeSchema.safeParse(req.body);
    if (!parse.success) {
      return sendError(reply, 400, 'INVALID_PAYLOAD', parse.error.message, req);
    }

    try {
      const metadata = await workerService.probe(parse.data.inputPath);
      return sendSuccess(reply, metadata, req);
    } catch (err) {
      return sendError(reply, 422, 'PROBE_FAILED', (err as Error).message, req);
    }
  });

  // Video processing (remux or transcode)
  const processVideoSchema = z.object({
    inputPath: z.string().min(1),
    outputPath: z.string().min(1),
    targetContainer: z.enum(['mp4', 'mkv', 'webm']).default('mp4'),
    targetResolution: z.enum(['8K', '4K', '1440p', '1080p', '720p', '480p', '360p']).optional(),
    targetCodec: z.enum(['h264', 'hevc', 'vp9', 'av1', 'copy']).optional(),
    crf: z.number().min(0).max(51).optional(),
    preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow']).optional(),
    maxBitrateKbps: z.number().positive().optional(),
    audioCodec: z.enum(['aac', 'opus', 'mp3', 'flac', 'pcm_s16le', 'vorbis', 'copy']).optional(),
    audioBitrateKbps: z.number().positive().optional(),
    timeoutMs: z.number().positive().optional()
  });

  server.post('/api/process-video', async (req, reply) => {
    const parse = processVideoSchema.safeParse(req.body);
    if (!parse.success) {
      return sendError(reply, 400, 'INVALID_PAYLOAD', parse.error.message, req);
    }

    try {
      const result = await workerService.processVideo(parse.data);
      return sendSuccess(reply, result, req);
    } catch (err) {
      return sendError(reply, 500, 'TRANSCODE_FAILED', (err as Error).message, req);
    }
  });

  // Audio extraction
  const extractAudioSchema = z.object({
    inputPath: z.string().min(1),
    outputPath: z.string().min(1),
    targetFormat: z.enum(['mp3', 'aac', 'm4a', 'flac', 'wav', 'opus', 'ogg', 'copy']),
    targetCodec: z.enum(['aac', 'mp3', 'opus', 'flac', 'pcm_s16le', 'vorbis', 'copy']).optional(),
    bitrateKbps: z.number().positive().optional(),
    sampleRate: z.number().positive().optional(),
    channels: z.number().min(1).max(8).optional(),
    timeoutMs: z.number().positive().optional()
  });

  server.post('/api/extract-audio', async (req, reply) => {
    const parse = extractAudioSchema.safeParse(req.body);
    if (!parse.success) {
      return sendError(reply, 400, 'INVALID_PAYLOAD', parse.error.message, req);
    }

    try {
      const result = await workerService.extractAudio(parse.data);
      return sendSuccess(reply, result, req);
    } catch (err) {
      return sendError(reply, 500, 'EXTRACTION_FAILED', (err as Error).message, req);
    }
  });

  // Audio / Video Merging
  const mergeSchema = z.object({
    videoInputPath: z.string().min(1),
    audioInputPath: z.string().min(1),
    outputPath: z.string().min(1),
    targetContainer: z.enum(['mp4', 'mkv', 'webm']).default('mp4'),
    audioOffsetMs: z.number().optional(),
    preferStreamCopy: z.boolean().default(true),
    timeoutMs: z.number().positive().optional()
  });

  server.post('/api/merge', async (req, reply) => {
    const parse = mergeSchema.safeParse(req.body);
    if (!parse.success) {
      return sendError(reply, 400, 'INVALID_PAYLOAD', parse.error.message, req);
    }

    try {
      const result = await workerService.mergeMedia(parse.data);
      return sendSuccess(reply, result, req);
    } catch (err) {
      return sendError(reply, 500, 'MERGE_FAILED', (err as Error).message, req);
    }
  });

  // Batch & Playlist Packaging
  const packageSchema = z.object({
    items: z.array(
      z.object({
        filePath: z.string().min(1),
        entryName: z.string().min(1),
        title: z.string().optional()
      })
    ).min(1),
    outputPath: z.string().min(1),
    archiveTitle: z.string().optional(),
    playlistMetadata: z.object({
      id: z.string().optional(),
      title: z.string().optional(),
      sourceReference: z.string().optional(),
      itemCount: z.number().optional()
    }).optional()
  });

  server.post('/api/package', async (req, reply) => {
    const parse = packageSchema.safeParse(req.body);
    if (!parse.success) {
      return sendError(reply, 400, 'INVALID_PAYLOAD', parse.error.message, req);
    }

    try {
      const result = await workerService.packageBatch(parse.data);
      return sendSuccess(reply, result, req);
    } catch (err) {
      return sendError(reply, 500, 'PACKAGING_FAILED', (err as Error).message, req);
    }
  });

  // Output Verification
  const verifySchema = z.object({
    filePath: z.string().min(1),
    expectedDurationSeconds: z.number().optional(),
    requireVideo: z.boolean().optional(),
    requireAudio: z.boolean().optional()
  });

  server.post('/api/verify', async (req, reply) => {
    const parse = verifySchema.safeParse(req.body);
    if (!parse.success) {
      return sendError(reply, 400, 'INVALID_PAYLOAD', parse.error.message, req);
    }

    try {
      const result = await workerService.verifyOutput(parse.data.filePath, {
        expectedDurationSeconds: parse.data.expectedDurationSeconds,
        requireVideo: parse.data.requireVideo,
        requireAudio: parse.data.requireAudio
      });
      return sendSuccess(reply, result, req);
    } catch (err) {
      return sendError(reply, 500, 'VERIFICATION_FAILED', (err as Error).message, req);
    }
  });

  // Scratch disk stats
  server.get('/api/scratch/stats', async (req, reply) => {
    return sendSuccess(reply, workerService.getDiskStats(), req);
  });

  return server;
}

// Start standalone server if invoked directly
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const server = createServer();
  server.listen({ port: PORT, host: HOST }, (err, address) => {
    if (err) {
      console.error('Failed to start MUXARO Media Worker:', err);
      process.exit(1);
    }
    console.log(`🚀 MUXARO Media Worker running at ${address}`);
  });
}
