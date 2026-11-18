/**
 * Project MUXARO - Asynchronous Job Processing Routes
 * POST /api/v1/jobs
 * GET  /api/v1/jobs/:id
 * GET  /api/v1/jobs/:id/events (Server-Sent Events)
 * POST /api/v1/jobs/:id/cancel
 * POST /api/v1/jobs/:id/retry
 * GET  /api/v1/jobs/:id/download
 */

import type { FastifyPluginAsync } from 'fastify';
import { queueService } from '../services/queue.service.js';
import { entitlementsService } from '../services/entitlements.service.js';
import { adapterService, UPLOADS_ROOT } from '../services/adapter.service.js';
import { resolveCallerIdentity, isOwnerOrAdmin } from '../services/request-identity.js';
import { DEFAULT_RETENTION_MINUTES, mapHumanFriendlyError } from '../services/turboflow.service.js';
import { hasPrototypePollution, validateUrlForSsrf, validateSafePath, RateLimiter } from '@vyro/security';
import type { CreateJobInput, JobOutputArtifact, JobProgressEvent, JobRecord } from '../types/index.js';

const rateLimiter = new RateLimiter();

function toPublicArtifact(artifact?: JobOutputArtifact) {
  if (!artifact) return null;
  const { filePath: _internalFilePath, ownerUserId: _owner, ...pub } = artifact;
  return pub;
}

function serializeJob(job: JobRecord) {
  const artifact = toPublicArtifact(job.artifact);
  const errorObj = job.error
    ? {
        code: job.error.code,
        message: job.error.message,
        userMessage: job.error.userMessage || mapHumanFriendlyError(job.error.code, job.error.message),
      }
    : null;

  return {
    id: job.jobId,
    jobId: job.jobId,
    batchId: job.batchId || null,
    itemNumber: job.itemNumber || null,
    ownerTier: job.ownerTier || 'GUEST',
    priorityWeight: job.priorityWeight ?? 1,
    status: job.status,
    progress: job.progress,
    stage: job.stage || job.status,
    stageMessage: job.stageMessage || '',
    inputTitle: job.inputTitle || null,
    operation: job.operation,
    targetFormat: job.targetFormat,
    targetResolution: job.targetResolution || null,
    streamCopy: job.streamCopy ?? false,
    processingLane: job.processingLane || 'smart',
    queueClass: job.queueClass || 'video-transcoding',
    strategyLabel: job.strategyLabel || 'Media Processing',
    losslessPreserved: job.losslessPreserved ?? false,
    retentionMinutes: job.retentionMinutes ?? DEFAULT_RETENTION_MINUTES,
    queuedAt: job.queuedAt || job.createdAt,
    startedAt: job.startedAt || null,
    queueWaitMs: job.queueWaitMs ?? null,
    processingMs: job.processingMs ?? null,
    downloadUrl: job.downloadUrl || null,
    outputFilename: artifact?.filename || null,
    outputSizeBytes: artifact?.sizeBytes || null,
    checksumSha256: artifact?.checksumSha256 || null,
    artifact,
    error: errorObj,
    userMessage: errorObj?.userMessage || null,
    expiresAt: job.expiresAt || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
  };
}

export const jobRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/jobs
  fastify.post('/jobs', {
    preHandler: rateLimiter.createFastifyHook('createJob'),
    schema: {
      description: 'Submit an asynchronous media processing job with atomic quota reservation',
      tags: ['Job Execution'],
      body: {
        type: 'object',
        required: ['operation', 'targetFormat', 'idempotencyKey'],
        properties: {
          mediaAssetId: { type: 'string' },
          mediaUrl: { type: 'string' },
          sourceUrl: { type: 'string' },
          operation: {
            type: 'string',
            enum: ['EXTRACT_AUDIO', 'REMUX_STREAM_COPY', 'TRANSCODE_VIDEO', 'CONVERT_FORMAT', 'MERGE_AUDIO_VIDEO'],
          },
          targetFormat: { type: 'string' },
          targetResolution: { type: 'string' },
          targetAudioCodec: { type: 'string' },
          title: { type: 'string' },
          streamCopy: { type: 'boolean' },
          formatId: { type: 'string' },
          idempotencyKey: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const body = request.body as CreateJobInput;

    // Guard against prototype pollution
    if (!body || typeof body !== 'object' || hasPrototypePollution(body)) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'ERR_INVALID_REQUEST',
          message: 'Invalid job creation payload',
          details: null,
        },
        requestId,
      });
    }

    // Resolve caller identity (authenticated SQLite cookie/Bearer session or scoped Guest)
    const caller = await resolveCallerIdentity(request);

    const idempotencyKey =
      (request.headers['idempotency-key'] as string) || body.idempotencyKey || `idem_${Date.now()}`;

    // Execute within idempotency guard
    try {
      const result = await entitlementsService.executeIdempotent(
        idempotencyKey,
        caller.userId,
        body,
        async () => {
          // Resolve sourceUrl, localFilePath & title from mediaAssetId or body
          let sourceUrl = body.mediaUrl || body.sourceUrl;
          let localFilePath: string | undefined;
          let resolvedTitle = body.title;

          if (body.mediaAssetId) {
            const asset = adapterService.getAsset(body.mediaAssetId);
            if (asset) {
              if (!resolvedTitle) resolvedTitle = asset.title;
              if (asset.localFilePath) {
                const pathCheck = validateSafePath(asset.localFilePath, [UPLOADS_ROOT], { mustExist: true });
                if (!pathCheck.isSafe || !pathCheck.resolvedPath) {
                  const err = new Error('Uploaded file has expired or is no longer available. Please upload it again.');
                  (err as any).statusCode = 404;
                  (err as any).code = 'ERR_UPLOAD_NOT_FOUND';
                  throw err;
                }
                localFilePath = pathCheck.resolvedPath;
                sourceUrl = undefined;
              } else {
                if (!sourceUrl) sourceUrl = asset.url;
                if (!asset.rightsCheck.canExtractStreams) {
                  const err = new Error(
                    asset.rightsCheck.reason ||
                      'Audiovisual downloading through this source integration is disabled per platform policy'
                  );
                  (err as any).statusCode = 403;
                  (err as any).code = 'ERR_DOWNLOAD_DISABLED_BY_POLICY';
                  throw err;
                }
              }
            }
          }

          if (!localFilePath) {
            if (!sourceUrl || typeof sourceUrl !== 'string' || sourceUrl.trim().length === 0) {
              const err = new Error('A valid mediaUrl or uploaded mediaAssetId is required');
              (err as any).statusCode = 400;
              (err as any).code = 'ERR_INVALID_REQUEST';
              throw err;
            }

            // Immediate SSRF validation before consuming quota
            const ssrf = await validateUrlForSsrf(sourceUrl);
            if (!ssrf.isSafe) {
              const err = new Error(ssrf.error || 'Target URL blocked by security policy');
              (err as any).statusCode = 403;
              (err as any).code = 'SSRF_BLOCKED';
              (err as any).details = {
                hostname: ssrf.hostname,
                resolvedIps: ssrf.resolvedIps,
                reason: ssrf.reason,
              };
              throw err;
            }
          }

          // Map operation to quota type
          const quotaType =
            body.operation === 'EXTRACT_AUDIO'
              ? 'AUDIO_EXTRACTION'
              : body.operation === 'MERGE_AUDIO_VIDEO'
              ? 'MEDIA_MERGE'
              : 'VIDEO_DOWNLOAD';

          // Atomic Quota Reservation
          let reservation;
          try {
            reservation = await entitlementsService.reserveQuota({
              userId: caller.userId,
              role: caller.entitlementRole,
              tier: caller.entitlementTier,
              jobType: quotaType,
              itemCount: 1,
              idempotencyKey,
            });
          } catch (quotaErr: any) {
            const err = new Error(quotaErr.message || 'Individual video job quota exceeded for this 24-hour rolling window.');
            (err as any).statusCode = 409;
            (err as any).code = 'ERR_QUOTA_EXCEEDED';
            (err as any).details = quotaErr.details || null;
            throw err;
          }

          // Enqueue Job into Durable 3-Tier Priority Queue
          const job = await queueService.enqueueJob(
            {
              ...body,
              mediaUrl: sourceUrl,
              localFilePath,
              title: resolvedTitle,
              ownerTier: caller.priorityTier,
              requestId,
              idempotencyKey,
            },
            caller.userId,
            reservation.reservationId
          );

          return serializeJob(job);
        }
      );

      return reply.code(202).send({
        success: true,
        data: result,
        requestId,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      const code = err.code || 'ERR_JOB_CREATION_FAILED';
      return reply.code(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to submit processing job',
          userMessage: mapHumanFriendlyError(code, err.message),
          details: err.details || null,
        },
        requestId,
      });
    }
  });

  // GET /api/v1/jobs/:id (no tight rate limit so long 4K/8K/compression polling never trips 429)
  fastify.get('/jobs/:id', {
    schema: {
      description: 'Retrieve current execution status and progress of a processing job',
      tags: ['Job Execution'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { id } = request.params as { id: string };

    const job = queueService.getJob(id);
    if (!job) {
      const code = 'ERR_JOB_NOT_FOUND';
      return reply.code(404).send({
        success: false,
        error: {
          code,
          message: `Job ${id} not found`,
          userMessage: mapHumanFriendlyError(code),
        },
        requestId,
      });
    }

    const caller = await resolveCallerIdentity(request);
    if (
      !isOwnerOrAdmin(caller, job.ownerUserId, {
        endpoint: `/api/v1/jobs/${id}`,
        resourceType: 'job',
        resourceId: id,
        requestId,
      })
    ) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_FORBIDDEN',
          message: 'Access denied to this processing job',
          userMessage: 'You do not have permission to view this job.',
        },
        requestId,
      });
    }

    return reply.code(200).send({
      success: true,
      data: serializeJob(job),
      requestId,
    });
  });

  // GET /api/v1/jobs/:id/events (Server-Sent Events)
  fastify.get('/jobs/:id/events', {
    schema: {
      description: 'Stream real-time job execution progress via Server-Sent Events',
      tags: ['Job Execution'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { id } = request.params as { id: string };
    const job = queueService.getJob(id);

    if (job) {
      const caller = await resolveCallerIdentity(request);
      if (
        !isOwnerOrAdmin(caller, job.ownerUserId, {
          endpoint: `/api/v1/jobs/${id}/events`,
          resourceType: 'job',
          resourceId: id,
          requestId,
        })
      ) {
        return reply.code(403).send({
          success: false,
          error: {
            code: 'ERR_FORBIDDEN',
            message: 'Access denied to this job event stream',
            userMessage: 'You do not have permission to access this job.',
          },
          requestId,
        });
      }
    }

    // Set headers for SSE stream
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering for instant delivery

    if (!job) {
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ error: 'Job not found', jobId: id })}\n\n`
      );
      reply.raw.end();
      return;
    }

    // Send initial state snapshot
    const initialEvent: JobProgressEvent = {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      stage: job.stage || job.status,
      message: job.stageMessage,
      downloadUrl: job.downloadUrl,
      artifact: toPublicArtifact(job.artifact) ?? undefined,
      error: job.error ? { code: job.error.code, message: job.error.message } : undefined,
      timestamp: new Date().toISOString(),
    };

    reply.raw.write(`event: progress\ndata: ${JSON.stringify(initialEvent)}\n\n`);

    // If job is already in terminal state, finish immediately
    if (['READY', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(job.status)) {
      reply.raw.write(`event: complete\ndata: ${JSON.stringify(initialEvent)}\n\n`);
      reply.raw.end();
      return;
    }

    // Subscribe to live job updates
    const onProgress = (event: JobProgressEvent) => {
      const sanitizedEvent: JobProgressEvent = {
        ...event,
        artifact: toPublicArtifact(event.artifact) ?? undefined,
      };
      reply.raw.write(`event: progress\ndata: ${JSON.stringify(sanitizedEvent)}\n\n`);

      if (['READY', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(event.status)) {
        reply.raw.write(`event: complete\ndata: ${JSON.stringify(sanitizedEvent)}\n\n`);
        cleanup();
        reply.raw.end();
      }
    };

    queueService.on(`job:${id}`, onProgress);

    // Keep-alive heartbeat comment every 15 seconds
    const heartbeatTimer = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        cleanup();
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeatTimer);
      queueService.removeListener(`job:${id}`, onProgress);
    };

    request.raw.on('close', cleanup);
    request.raw.on('end', cleanup);
  });

  // POST /api/v1/jobs/:id/cancel
  fastify.post('/jobs/:id/cancel', {
    schema: {
      description: 'Cancel a queued or processing job and immediately refund reserved quota',
      tags: ['Job Execution'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { id } = request.params as { id: string };

    const existing = queueService.getJob(id);
    if (!existing) {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_JOB_NOT_FOUND',
          message: `Job ${id} not found`,
          userMessage: mapHumanFriendlyError('ERR_JOB_NOT_FOUND'),
        },
        requestId,
      });
    }

    const caller = await resolveCallerIdentity(request);
    if (
      !isOwnerOrAdmin(caller, existing.ownerUserId, {
        endpoint: `/api/v1/jobs/${id}/cancel`,
        resourceType: 'job',
        resourceId: id,
        requestId,
      })
    ) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_FORBIDDEN',
          message: 'Access denied to cancel this job',
          userMessage: 'You do not have permission to cancel this job.',
        },
        requestId,
      });
    }

    try {
      const cancelledJob = await queueService.cancelJob(id, 'User requested cancellation');

      return reply.code(200).send({
        success: true,
        data: {
          id: cancelledJob.jobId,
          jobId: cancelledJob.jobId,
          status: cancelledJob.status,
          stage: cancelledJob.stage,
          message: 'Job cancelled successfully. Quota reservation released.',
        },
        requestId,
      });
    } catch (err: any) {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_JOB_CANCEL_FAILED',
          message: err.message || 'Failed to cancel job',
          userMessage: mapHumanFriendlyError('ERR_JOB_CANCEL_FAILED', err.message),
        },
        requestId,
      });
    }
  });

  // POST /api/v1/jobs/:id/retry
  fastify.post('/jobs/:id/retry', {
    schema: {
      description: 'Retry a failed job if attempts remain',
      tags: ['Job Execution'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { id } = request.params as { id: string };

    const existing = queueService.getJob(id);
    if (!existing) {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_JOB_NOT_FOUND',
          message: `Job ${id} not found`,
          userMessage: mapHumanFriendlyError('ERR_JOB_NOT_FOUND'),
        },
        requestId,
      });
    }

    const caller = await resolveCallerIdentity(request);
    if (
      !isOwnerOrAdmin(caller, existing.ownerUserId, {
        endpoint: `/api/v1/jobs/${id}/retry`,
        resourceType: 'job',
        resourceId: id,
        requestId,
      })
    ) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_FORBIDDEN',
          message: 'Access denied to retry this job',
          userMessage: 'You do not have permission to retry this job.',
        },
        requestId,
      });
    }

    try {
      const retriedJob = await queueService.retryJob(id);

      return reply.code(200).send({
        success: true,
        data: serializeJob(retriedJob),
        requestId,
      });
    } catch (err: any) {
      const code = err.code || 'ERR_RETRY_FAILED';
      return reply.code(err.statusCode || 400).send({
        success: false,
        error: {
          code,
          message: err.message || 'Cannot retry job',
          userMessage: mapHumanFriendlyError(code, err.message),
        },
        requestId,
      });
    }
  });

  // GET /api/v1/jobs/:id/download
  fastify.get('/jobs/:id/download', {
    schema: {
      description: 'Redirect to signed download endpoint for completed job artifact',
      tags: ['Job Execution'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          inline: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { id } = request.params as { id: string };
    const query = (request.query || {}) as { inline?: string };
    const isInline = query.inline === '1' || query.inline === 'true';

    const job = queueService.getJob(id);
    if (!job) {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_ARTIFACT_NOT_READY',
          message: `Job ${id} output artifact is not ready or has expired`,
          userMessage: mapHumanFriendlyError('ERR_ARTIFACT_NOT_READY'),
        },
        requestId,
      });
    }

    const caller = await resolveCallerIdentity(request);
    if (
      !isOwnerOrAdmin(caller, job.ownerUserId, {
        endpoint: `/api/v1/jobs/${id}/download`,
        resourceType: 'job',
        resourceId: id,
        requestId,
      })
    ) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_FORBIDDEN',
          message: 'Access denied to download this job artifact',
          userMessage: 'You do not have permission to download this file.',
        },
        requestId,
      });
    }

    if (!job.artifact || job.status !== 'READY') {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_ARTIFACT_NOT_READY',
          message: `Job ${id} output artifact is not ready or has expired`,
          userMessage: mapHumanFriendlyError('ERR_ARTIFACT_NOT_READY'),
        },
        requestId,
      });
    }

    if (job.downloadUrl) {
      const targetUrl = isInline
        ? `${job.downloadUrl}${job.downloadUrl.includes('?') ? '&' : '?'}inline=1`
        : job.downloadUrl;
      return reply.redirect(targetUrl, 302);
    }

    return reply.code(200).send({
      success: true,
      data: toPublicArtifact(job.artifact),
      requestId,
    });
  });
};
