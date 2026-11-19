/**
 * Project MUXARO - Standalone Media Tools Routes
 * POST /api/v1/tools/merge (Audio/Video multiplexing)
 */

import type { FastifyPluginAsync } from 'fastify';
import { queueService } from '../services/queue.service.js';
import { entitlementsService } from '../services/entitlements.service.js';
import { validateMergeJobRequest, RateLimiter } from '@vyro/security';
import type { MergeJobInput } from '../types/index.js';

const rateLimiter = new RateLimiter();

export const toolsRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/tools/merge
  fastify.post('/tools/merge', {
    preHandler: rateLimiter.createFastifyHook('createJob'),
    schema: {
      description: 'Submit an audio/video multiplexing job with millisecond synchronization offset',
      tags: ['Media Tools'],
      body: {
        type: 'object',
        required: ['targetFormat', 'idempotencyKey'],
        properties: {
          videoAssetId: { type: 'string' },
          videoUrl: { type: 'string', format: 'uri' },
          audioAssetId: { type: 'string' },
          audioUrl: { type: 'string', format: 'uri' },
          targetFormat: { type: 'string', default: 'mp4' },
          audioOffsetMs: { type: 'integer', default: 0 },
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
    const body = request.body as MergeJobInput;

    try {
      validateMergeJobRequest(body);
    } catch (valErr: any) {
      return (reply as any).code(400).send({
        success: false,
        error: {
          code: 'ERR_INVALID_REQUEST',
          message: valErr.message || 'Invalid merge request parameters',
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
      (request.headers['idempotency-key'] as string) || body.idempotencyKey || `idem_merge_${Date.now()}`;

    try {
      const result = await entitlementsService.executeIdempotent(
        idempotencyKey,
        session.userId,
        body,
        async () => {
          // Reserve quota for media merge
          let reservation;
          try {
            reservation = await entitlementsService.reserveQuota({
              userId: session.userId,
              role: session.role,
              tier: session.tier,
              jobType: 'MEDIA_MERGE',
              itemCount: 1,
              idempotencyKey,
            });
          } catch (quotaErr: any) {
            const err = new Error(quotaErr.message || 'Quota exceeded for media merge operation');
            (err as any).statusCode = 409;
            (err as any).code = 'ERR_QUOTA_EXCEEDED';
            (err as any).details = quotaErr.details || null;
            throw err;
          }

          const job = await queueService.enqueueMergeJob(
            {
              ...body,
              idempotencyKey,
            },
            session.userId,
            reservation.reservationId
          );

          return {
            jobId: job.jobId,
            status: job.status,
            progress: job.progress,
            operation: job.operation,
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
