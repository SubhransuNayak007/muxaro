/**
 * Project MUXARO - Standalone Media Tools Routes
 * POST /api/v1/tools/merge (Audio/Video multiplexing & multi-clip video concatenation)
 */

import crypto from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import {
  assertSafeMediaUrl,
  MuxaroError,
  RETENTION_SECONDS,
  type RetentionTier,
} from '@muxaro/shared';
import { validateMergeJobRequest, validateUrlForSsrf, RateLimiter } from '@vyro/security';
import { queueService } from '../services/queue.service.js';
import { entitlementsService } from '../services/entitlements.service.js';
import { getTranscodeQueue } from '../lib/queues.js';
import { getS3Client, getStorageConfig } from '../lib/s3.js';
import { mintScopedWorkerTicket } from '../security/scoped-job-urls.js';
import type { MergeJobInput } from '../types/index.js';

const rateLimiter = new RateLimiter();
const ALLOWED_MERGE_CONTAINERS = new Set(['mp4', 'mkv', 'webm', 'mov']);

interface MergeToolBody extends Partial<MergeJobInput> {
  operation?: string;
  clipUrls?: string[];
  targetResolution?: string;
  normalizeLoudness?: boolean;
  normalizeAudio?: boolean;
  preserveVideoStream?: boolean;
  streamCopy?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  audioBitrate?: string;
}

export const toolsRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/tools/merge
  fastify.post('/tools/merge', {
    preHandler: rateLimiter.createFastifyHook('createJob'),
    schema: {
      description: 'Submit an audio/video multiplexing job or multi-clip video concatenation job (CONCAT_VIDEO)',
      tags: ['Media Tools'],
      body: {
        type: 'object',
        properties: {
          operation: { type: 'string' },
          clipUrls: { type: 'array', items: { type: 'string' } },
          videoAssetId: { type: 'string' },
          videoUrl: { type: 'string' },
          audioAssetId: { type: 'string' },
          audioUrl: { type: 'string' },
          targetFormat: { type: 'string', default: 'mp4' },
          targetResolution: { type: 'string' },
          audioOffsetMs: { type: 'integer', default: 0 },
          normalizeLoudness: { type: 'boolean' },
          normalizeAudio: { type: 'boolean' },
          preserveVideoStream: { type: 'boolean' },
          streamCopy: { type: 'boolean' },
          videoCodec: { type: 'string' },
          audioCodec: { type: 'string' },
          audioBitrate: { type: 'string' },
          title: { type: 'string' },
          idempotencyKey: { type: 'string' },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                jobId: { type: 'string' },
                status: { type: 'string' },
                progress: { type: 'number' },
                operation: { type: 'string' },
                targetFormat: { type: 'string', nullable: true },
                targetResolution: { type: 'string', nullable: true },
                clipCount: { type: 'number', nullable: true },
                downloadUrl: { type: 'string', nullable: true },
                expiresAt: { type: 'string', nullable: true },
              },
            },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const body = (request.body || {}) as MergeToolBody;
    const targetFormat = String(body.targetFormat || 'mp4').trim().toLowerCase();

    if (!ALLOWED_MERGE_CONTAINERS.has(targetFormat)) {
      return (reply as any).code(400).send({
        success: false,
        error: {
          code: 'ERR_INVALID_REQUEST',
          message: `Invalid merge output container '${targetFormat}'. Must be mp4, mkv, webm, or mov.`,
          details: null,
        },
        requestId,
      });
    }

    const rawClipUrls = Array.isArray(body.clipUrls)
      ? body.clipUrls.map((u) => String(u || '').trim()).filter(Boolean)
      : [];
    const requestedOperation = String(body.operation || '').trim().toUpperCase();
    const isConcatMode = requestedOperation === 'CONCAT_VIDEO' || rawClipUrls.length > 0;

    // Validate & SSRF-check all inputs before quota reservation
    try {
      if (isConcatMode) {
        if (rawClipUrls.length < 2) {
          return (reply as any).code(400).send({
            success: false,
            error: {
              code: 'ERR_INVALID_REQUEST',
              message: 'CONCAT_VIDEO requires at least 2 clipUrls',
              details: null,
            },
            requestId,
          });
        }
        if (rawClipUrls.length > 25) {
          return (reply as any).code(400).send({
            success: false,
            error: {
              code: 'ERR_INVALID_REQUEST',
              message: 'CONCAT_VIDEO supports at most 25 clipUrls per job',
              details: null,
            },
            requestId,
          });
        }
        for (const clipUrl of rawClipUrls) {
          await assertSafeMediaUrl(clipUrl);
          const secResult = await validateUrlForSsrf(clipUrl);
          if (!secResult.isSafe) {
            throw MuxaroError.ssrfBlocked(secResult.reason || secResult.error || 'Clip URL blocked by SSRF guard');
          }
        }
      } else {
        const videoRef = body.videoUrl || body.videoAssetId;
        const audioRef = body.audioUrl || body.audioAssetId;
        const validation = validateMergeJobRequest({
          videoUrlOrId: videoRef,
          audioUrlOrId: audioRef,
          outputFormat: targetFormat,
          offsetMs: body.audioOffsetMs ?? 0,
        });
        if (!validation.success) {
          return (reply as any).code(400).send({
            success: false,
            error: {
              code: 'ERR_INVALID_REQUEST',
              message: validation.errors?.[0]?.message || 'Invalid merge request parameters',
              details: validation.errors || null,
            },
            requestId,
          });
        }

        if (body.videoUrl) {
          await assertSafeMediaUrl(body.videoUrl);
          const secResult = await validateUrlForSsrf(body.videoUrl);
          if (!secResult.isSafe) {
            throw MuxaroError.ssrfBlocked(secResult.reason || secResult.error || 'Video URL blocked by SSRF guard');
          }
        }
        if (body.audioUrl) {
          await assertSafeMediaUrl(body.audioUrl);
          const secResult = await validateUrlForSsrf(body.audioUrl);
          if (!secResult.isSafe) {
            throw MuxaroError.ssrfBlocked(secResult.reason || secResult.error || 'Audio URL blocked by SSRF guard');
          }
        }
      }
    } catch (secErr: any) {
      const statusCode = secErr instanceof MuxaroError ? secErr.statusCode : (secErr?.statusCode || 403);
      return (reply as any).code(statusCode).send({
        success: false,
        error: {
          code: secErr?.code || 'SSRF_BLOCKED',
          message: secErr?.message || 'Target URL blocked by SSRF security guard',
          details: null,
        },
        requestId,
      });
    }

    const authHeader = request.headers.authorization;
    const clientIp = request.ip || '127.0.0.1';
    const userAgent = request.headers['user-agent'];
    const { session } = await entitlementsService.resolveSession(authHeader, clientIp, userAgent);

    const idempotencyKey =
      (request.headers['idempotency-key'] as string) ||
      body.idempotencyKey ||
      `idem_merge_${crypto.randomUUID()}`;

    const normalizeAudio = Boolean(body.normalizeLoudness ?? body.normalizeAudio);
    const streamCopy = body.preserveVideoStream ?? body.streamCopy;
    const isGuestSession = session.role === 'anonymous';
    const isProSession =
      session.tier === 'pro' ||
      session.tier === 'enterprise' ||
      session.role === 'pro' ||
      session.role === 'admin';
    const ownerTier = isProSession ? 'PREMIUM' : isGuestSession ? 'GUEST' : 'REGISTERED';

    try {
      const result = await entitlementsService.executeIdempotent(
        idempotencyKey,
        session.userId,
        body,
        async () => {
          let reservation;
          try {
            reservation = await entitlementsService.reserveQuota({
              userId: session.userId,
              role: session.role,
              tier: session.tier,
              jobType: 'MEDIA_MERGE',
              itemCount: isConcatMode ? rawClipUrls.length : 1,
              idempotencyKey,
            });
          } catch (quotaErr: any) {
            const err = new Error(quotaErr.message || 'Quota exceeded for media merge operation');
            (err as any).statusCode = 409;
            (err as any).code = 'ERR_QUOTA_EXCEEDED';
            (err as any).details = quotaErr.details || null;
            throw err;
          }

          let job;
          if (isConcatMode) {
            job = await queueService.enqueueJob(
              {
                operation: 'CONCAT_VIDEO' as any,
                sourceUrl: rawClipUrls[0],
                mediaUrl: rawClipUrls[0],
                targetFormat,
                targetResolution: body.targetResolution,
                streamCopy,
                title: body.title || `Merged Video (${rawClipUrls.length} clips)`,
                idempotencyKey,
                ownerTier: ownerTier as any,
                metadata: {
                  clipUrls: rawClipUrls,
                  operation: 'CONCAT_VIDEO',
                  normalizeAudio,
                  videoCodec: body.videoCodec,
                  audioCodec: body.audioCodec,
                  audioBitrate: body.audioBitrate,
                },
              },
              session.userId,
              reservation.reservationId
            );
          } else {
            job = await queueService.enqueueMergeJob(
              {
                videoAssetId: body.videoAssetId,
                videoUrl: body.videoUrl,
                audioAssetId: body.audioAssetId,
                audioUrl: body.audioUrl,
                targetFormat,
                audioOffsetMs: body.audioOffsetMs ?? 0,
                idempotencyKey,
                title: body.title,
                metadata: {
                  targetResolution: body.targetResolution,
                  normalizeAudio,
                  streamCopy,
                  videoCodec: body.videoCodec,
                  audioCodec: body.audioCodec,
                  audioBitrate: body.audioBitrate,
                },
              },
              session.userId,
              reservation.reservationId
            );
          }

          // When Redis/BullMQ is active outside unit tests, also push full job payload to worker-media transcode lane
          if (process.env.NODE_ENV !== 'test' && process.env.REDIS_URL) {
            try {
              const retentionTier: RetentionTier = isGuestSession ? '60m' : '24h';
              const outputKey = `artifacts/${job.jobId}/output.${targetFormat}`;
              const contentType = targetFormat === 'webm' ? 'video/webm' : `video/${targetFormat}`;
              const scopedTicket = await mintScopedWorkerTicket(
                getS3Client(),
                getStorageConfig().artifactsBucket,
                {
                  jobId: job.jobId,
                  outputKey,
                  contentType,
                  retention: retentionTier,
                }
              ).catch(() => undefined);

              const q = getTranscodeQueue();
              await Promise.race([
                q.add(
                  'process_transcode',
                  {
                    jobId: job.jobId,
                    userId: session.userId,
                    tier: isProSession ? 'pro' : isGuestSession ? 'guest' : 'free_account',
                    tool: 'merge_av',
                    operation: isConcatMode ? 'CONCAT_VIDEO' : 'MERGE_AUDIO_VIDEO',
                    lane: 'transcode',
                    sourceUrl: isConcatMode ? rawClipUrls[0] : body.videoUrl,
                    clipUrls: isConcatMode ? rawClipUrls : undefined,
                    videoAssetId: body.videoAssetId,
                    uploadSessionId: body.videoAssetId,
                    audioAssetId: body.audioAssetId,
                    audioUrl: body.audioUrl,
                    secondaryAudioUrl: body.audioUrl,
                    secondaryAudioSessionId: body.audioAssetId,
                    audioOffsetMs: body.audioOffsetMs ?? 0,
                    normalizeAudio,
                    streamCopy,
                    ecoMode: streamCopy,
                    targetFormat,
                    targetResolution: body.targetResolution,
                    videoCodec: body.videoCodec,
                    audioCodec: body.audioCodec,
                    audioBitrate: body.audioBitrate,
                    title: body.title,
                    retentionTier,
                    expiresAt: new Date(Date.now() + RETENTION_SECONDS[retentionTier] * 1000).toISOString(),
                    outputStorageKey: outputKey,
                    scopedTicket,
                    scopedJobUrls: scopedTicket,
                  },
                  {
                    jobId: job.jobId,
                    priority: isProSession ? 1 : isGuestSession ? 10 : 5,
                    removeOnComplete: 200,
                  }
                ),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('BullMQ timeout')), 1000)),
              ]);
            } catch {
              // In-process queueService remains active fallback if Redis/BullMQ is unavailable
            }
          }

          return {
            jobId: job.jobId,
            status: job.status,
            progress: job.progress,
            operation: isConcatMode ? 'CONCAT_VIDEO' : job.operation,
            targetFormat,
            targetResolution: body.targetResolution || null,
            clipCount: isConcatMode ? rawClipUrls.length : null,
            downloadUrl: job.downloadUrl || null,
            expiresAt: job.expiresAt || null,
          };
        }
      );

      return reply.code(202).send({
        success: true,
        data: result,
        requestId,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      return reply.code(statusCode).send({
        success: false,
        error: {
          code: err.code || 'ERR_MERGE_JOB_FAILED',
          message: err.message || 'Failed to submit merge job',
          details: err.details || null,
        },
        requestId,
      });
    }
  });
};
