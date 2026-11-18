/**
 * Project MUXARO - Batch Processing Routes (MXB-YYYYMMDD-XXXXXX + 001/002/003 Item Numbering)
 * POST /api/v1/batches
 * GET  /api/v1/batches
 * GET  /api/v1/batches/:id
 * GET  /api/v1/batches/:id/jobs
 * POST /api/v1/batches/:id/cancel
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDb, getNumericSetting } from '../db/database.js';
import { generateBatchId, formatBatchItemNumber } from '../services/id.service.js';
import { queueService } from '../services/queue.service.js';
import { adapterService, UPLOADS_ROOT } from '../services/adapter.service.js';
import { entitlementsService } from '../services/entitlements.service.js';
import { resolveCallerIdentity, isOwnerOrAdmin } from '../services/request-identity.js';
import { DEFAULT_RETENTION_MINUTES, mapHumanFriendlyError } from '../services/turboflow.service.js';
import { validateUrlForSsrf, validateSafePath, hasPrototypePollution, RateLimiter } from '@vyro/security';
import type { JobOperation, JobRecord } from '../types/index.js';

const rateLimiter = new RateLimiter();

interface DbBatchRow {
  id: string;
  owner_user_id: string;
  owner_tier: string;
  title: string;
  source_url: string | null;
  status: string;
  total_items: number;
  completed_items: number;
  failed_items: number;
  cancelled_items: number;
  progress: number;
  zip_download_url: string | null;
  zip_filename: string | null;
  zip_size_bytes: number | null;
  retention_minutes: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

function serializeBatchRow(row: DbBatchRow) {
  return {
    id: row.id,
    batchId: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    ownerTier: row.owner_tier,
    status: row.status,
    totalItems: row.total_items,
    completedItems: row.completed_items,
    failedItems: row.failed_items,
    cancelledItems: row.cancelled_items,
    progress: row.progress,
    zipDownloadUrl: row.zip_download_url,
    zipFilename: row.zip_filename,
    zipSizeBytes: row.zip_size_bytes,
    retentionMinutes: row.retention_minutes || DEFAULT_RETENTION_MINUTES,
    error: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
  };
}

function serializeBatchChildJob(job: JobRecord) {
  const artifact = job.artifact
    ? {
        artifactId: job.artifact.artifactId,
        filename: job.artifact.filename,
        mimeType: job.artifact.mimeType,
        sizeBytes: job.artifact.sizeBytes,
        container: job.artifact.container,
        codec: job.artifact.codec,
        durationSeconds: job.artifact.durationSeconds,
        checksumSha256: job.artifact.checksumSha256,
        downloadUrl: job.artifact.downloadUrl,
        expiresAt: job.artifact.expiresAt,
      }
    : null;

  return {
    id: job.jobId,
    jobId: job.jobId,
    batchId: job.batchId || null,
    itemNumber: job.itemNumber || null,
    ownerTier: job.ownerTier || 'GUEST',
    status: job.status,
    progress: job.progress,
    stage: job.stage || job.status,
    stageMessage: job.stageMessage || '',
    inputTitle: job.inputTitle || null,
    operation: job.operation,
    targetFormat: job.targetFormat,
    targetResolution: job.targetResolution || null,
    processingLane: job.processingLane || 'smart',
    queueClass: job.queueClass || 'video-transcoding',
    strategyLabel: job.strategyLabel || 'Media Processing',
    losslessPreserved: job.losslessPreserved ?? false,
    retentionMinutes: job.retentionMinutes ?? DEFAULT_RETENTION_MINUTES,
    downloadUrl: job.downloadUrl || null,
    outputFilename: artifact?.filename || null,
    outputSizeBytes: artifact?.sizeBytes || null,
    artifact,
    error: job.error || null,
    userMessage: job.error?.userMessage || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
    expiresAt: job.expiresAt || null,
  };
}

interface BatchCreateItemInput {
  mediaUrl?: string;
  mediaAssetId?: string;
  title?: string;
  operation?: JobOperation;
  targetFormat?: string;
  targetResolution?: string;
  streamCopy?: boolean;
}

export const batchRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/batches
  fastify.post('/batches', {
    preHandler: rateLimiter.createFastifyHook('createJob'),
    schema: {
      description: 'Create a tracked batch job (MXB-YYYYMMDD-XXXXXX) with 001/002/003 numbered child jobs',
      tags: ['Batch Processing'],
      body: {
        type: 'object',
        required: ['items'],
        properties: {
          title: { type: 'string' },
          sourceUrl: { type: 'string' },
          operation: {
            type: 'string',
            enum: ['EXTRACT_AUDIO', 'REMUX_STREAM_COPY', 'TRANSCODE_VIDEO', 'CONVERT_FORMAT', 'MERGE_AUDIO_VIDEO'],
          },
          targetFormat: { type: 'string', default: 'mp4' },
          targetResolution: { type: 'string' },
          streamCopy: { type: 'boolean' },
          idempotencyKey: { type: 'string' },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              type: 'object',
              properties: {
                mediaUrl: { type: 'string' },
                mediaAssetId: { type: 'string' },
                title: { type: 'string' },
                operation: {
                  type: 'string',
                  enum: ['EXTRACT_AUDIO', 'REMUX_STREAM_COPY', 'TRANSCODE_VIDEO', 'CONVERT_FORMAT', 'MERGE_AUDIO_VIDEO'],
                },
                targetFormat: { type: 'string' },
                targetResolution: { type: 'string' },
                streamCopy: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const body = request.body as {
      title?: string;
      sourceUrl?: string;
      operation?: JobOperation;
      targetFormat?: string;
      targetResolution?: string;
      streamCopy?: boolean;
      idempotencyKey?: string;
      items: BatchCreateItemInput[];
    };

    if (!body || hasPrototypePollution(body) || !Array.isArray(body.items) || body.items.length === 0) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'ERR_INVALID_REQUEST',
          message: 'Batch must include at least one media item',
          userMessage: 'Please add at least one link or uploaded file to start a batch.',
        },
        requestId,
      });
    }

    const maxItems = getNumericSetting('max_playlist_items', 50);
    if (body.items.length > maxItems) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'ERR_INVALID_REQUEST',
          message: `Batch exceeds maximum of ${maxItems} items`,
          userMessage: `A batch can include up to ${maxItems} items at a time.`,
        },
        requestId,
      });
    }

    const caller = await resolveCallerIdentity(request);
    const idempotencyKey =
      (request.headers['idempotency-key'] as string) ||
      body.idempotencyKey ||
      `idem_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Validate every item upfront before reserving quota or persisting the batch
    const validatedItems: Array<{
      itemNumber: string;
      mediaUrl?: string;
      localFilePath?: string;
      mediaAssetId?: string;
      title?: string;
      operation: JobOperation;
      targetFormat: string;
      targetResolution?: string;
      streamCopy?: boolean;
    }> = [];

    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];
      const itemNumber = formatBatchItemNumber(i + 1);
      let sourceUrl = item.mediaUrl;
      let localFilePath: string | undefined;
      let title = item.title;

      if (item.mediaAssetId) {
        const asset = adapterService.getAsset(item.mediaAssetId);
        if (asset) {
          if (!title) title = asset.title;
          if (asset.localFilePath) {
            const safe = validateSafePath(asset.localFilePath, [UPLOADS_ROOT], { mustExist: true });
            if (!safe.isSafe || !safe.resolvedPath) {
              return reply.code(404).send({
                success: false,
                error: {
                  code: 'ERR_UPLOAD_NOT_FOUND',
                  message: `Item ${itemNumber} uploaded file has expired`,
                  userMessage: mapHumanFriendlyError('ERR_UPLOAD_NOT_FOUND'),
                },
                requestId,
              });
            }
            localFilePath = safe.resolvedPath;
            sourceUrl = undefined;
          } else if (!sourceUrl) {
            sourceUrl = asset.url;
          }
        }
      }

      if (!localFilePath) {
        if (!sourceUrl || typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
          return reply.code(400).send({
            success: false,
            error: {
              code: 'ERR_INVALID_REQUEST',
              message: `Item ${itemNumber} is missing a valid mediaUrl or mediaAssetId`,
              userMessage: `Item ${itemNumber} is missing a valid link or uploaded file.`,
            },
            requestId,
          });
        }
        const ssrf = await validateUrlForSsrf(sourceUrl);
        if (!ssrf.isSafe) {
          return reply.code(403).send({
            success: false,
            error: {
              code: 'SSRF_BLOCKED',
              message: ssrf.error || `Item ${itemNumber} URL blocked by security policy`,
              userMessage: mapHumanFriendlyError('SSRF_BLOCKED'),
            },
            requestId,
          });
        }
      }

      validatedItems.push({
        itemNumber,
        mediaUrl: sourceUrl,
        localFilePath,
        mediaAssetId: item.mediaAssetId,
        title,
        operation: item.operation || body.operation || 'REMUX_STREAM_COPY',
        targetFormat: (item.targetFormat || body.targetFormat || 'mp4').toLowerCase().trim(),
        targetResolution: item.targetResolution || body.targetResolution,
        streamCopy: item.streamCopy ?? body.streamCopy,
      });
    }

    // Reserve quota for batch items
    let reservation;
    try {
      reservation = await entitlementsService.reserveQuota({
        userId: caller.userId,
        role: caller.entitlementRole,
        tier: caller.entitlementTier,
        jobType: validatedItems.length > 1 ? 'PLAYLIST_DOWNLOAD' : 'VIDEO_DOWNLOAD',
        itemCount: validatedItems.length,
        idempotencyKey,
      });
    } catch (quotaErr: any) {
      const code = 'ERR_QUOTA_EXCEEDED';
      return reply.code(409).send({
        success: false,
        error: {
          code,
          message: quotaErr.message || 'Quota exceeded for batch submission',
          userMessage: mapHumanFriendlyError(code, quotaErr.message),
          details: quotaErr.details || null,
        },
        requestId,
      });
    }

    const batchId = generateBatchId();
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + DEFAULT_RETENTION_MINUTES * 60 * 1000).toISOString();
    const batchTitle = (body.title || `Batch (${validatedItems.length} items)`).trim();

    const db = getDb();
    db.prepare(
      `INSERT INTO batches (
        id, owner_user_id, owner_tier, title, source_url, status,
        total_items, completed_items, failed_items, cancelled_items, progress,
        retention_minutes, idempotency_key, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, 0, 0, 0, 0, ?, ?, ?, ?, ?)`
    ).run(
      batchId,
      caller.userId,
      caller.priorityTier,
      batchTitle,
      body.sourceUrl ?? null,
      validatedItems.length,
      DEFAULT_RETENTION_MINUTES,
      idempotencyKey,
      nowIso,
      nowIso,
      expiresAt
    );

    const jobs: JobRecord[] = [];
    for (const item of validatedItems) {
      const job = await queueService.enqueueJob(
        {
          mediaAssetId: item.mediaAssetId,
          mediaUrl: item.mediaUrl,
          localFilePath: item.localFilePath,
          batchId,
          itemNumber: item.itemNumber,
          operation: item.operation,
          targetFormat: item.targetFormat,
          targetResolution: item.targetResolution,
          title: item.title,
          streamCopy: item.streamCopy,
          ownerTier: caller.priorityTier,
          requestId,
          idempotencyKey: `${idempotencyKey}_${item.itemNumber}`,
        },
        caller.userId,
        item.itemNumber === '001' ? reservation.reservationId : undefined
      );
      jobs.push(job);
    }

    const batchRow = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId) as unknown as DbBatchRow;

    return reply.code(202).send({
      success: true,
      data: {
        ...serializeBatchRow(batchRow),
        jobs: jobs.map(serializeBatchChildJob),
      },
      requestId,
    });
  });

  // GET /api/v1/batches (strictly scoped to caller's own batches)
  fastify.get('/batches', {
    schema: {
      description: 'List batches owned by the current authenticated user or guest session',
      tags: ['Batch Processing'],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const query = (request.query || {}) as { page?: number; limit?: number };
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const offset = (page - 1) * limit;

    const caller = await resolveCallerIdentity(request);
    const db = getDb();
    const totalRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM batches WHERE owner_user_id = ?')
      .get(caller.userId) as { cnt: number } | undefined;
    const rows = db
      .prepare(
        `SELECT * FROM batches
         WHERE owner_user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(caller.userId, limit, offset) as unknown as DbBatchRow[];

    return reply.code(200).send({
      success: true,
      data: {
        total: Number(totalRow?.cnt || 0),
        page,
        limit,
        batches: rows.map(serializeBatchRow),
      },
      requestId,
    });
  });

  // GET /api/v1/batches/:id (strict IDOR owner check)
  fastify.get('/batches/:id', {
    schema: {
      description: 'Get details of a specific batch (strictly owner-scoped)',
      tags: ['Batch Processing'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { id } = request.params as { id: string };
    const caller = await resolveCallerIdentity(request);

    const db = getDb();
    const row = db.prepare('SELECT * FROM batches WHERE id = ? LIMIT 1').get(id) as DbBatchRow | undefined;
    if (!row) {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_BATCH_NOT_FOUND',
          message: `Batch ${id} not found`,
          userMessage: 'We could not find that batch.',
        },
        requestId,
      });
    }

    if (
      !isOwnerOrAdmin(caller, row.owner_user_id, {
        endpoint: `/api/v1/batches/${id}`,
        resourceType: 'batch',
        resourceId: id,
        requestId,
      })
    ) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_FORBIDDEN',
          message: 'Access denied to this batch',
          userMessage: 'You do not have permission to view this batch.',
        },
        requestId,
      });
    }

    return reply.code(200).send({
      success: true,
      data: serializeBatchRow(row),
      requestId,
    });
  });

  // GET /api/v1/batches/:id/jobs (strict IDOR owner check, returns 001/002/003 ordered jobs)
  fastify.get('/batches/:id/jobs', {
    schema: {
      description: 'List ordered child jobs (001, 002, 003...) belonging to a batch',
      tags: ['Batch Processing'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { id } = request.params as { id: string };
    const caller = await resolveCallerIdentity(request);

    const db = getDb();
    const row = db.prepare('SELECT * FROM batches WHERE id = ? LIMIT 1').get(id) as DbBatchRow | undefined;
    if (!row) {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_BATCH_NOT_FOUND',
          message: `Batch ${id} not found`,
          userMessage: 'We could not find that batch.',
        },
        requestId,
      });
    }

    if (
      !isOwnerOrAdmin(caller, row.owner_user_id, {
        endpoint: `/api/v1/batches/${id}/jobs`,
        resourceType: 'batch',
        resourceId: id,
        requestId,
      })
    ) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_FORBIDDEN',
          message: 'Access denied to this batch',
          userMessage: 'You do not have permission to view jobs in this batch.',
        },
        requestId,
      });
    }

    const jobs = queueService.getBatchJobs(id);
    return reply.code(200).send({
      success: true,
      data: {
        batchId: id,
        total: jobs.length,
        jobs: jobs.map(serializeBatchChildJob),
      },
      requestId,
    });
  });

  // POST /api/v1/batches/:id/cancel (strict IDOR owner check)
  fastify.post('/batches/:id/cancel', {
    schema: {
      description: 'Cancel all active/queued jobs in a batch (strictly owner-scoped)',
      tags: ['Batch Processing'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const { id } = request.params as { id: string };
    const caller = await resolveCallerIdentity(request);

    const db = getDb();
    const row = db.prepare('SELECT * FROM batches WHERE id = ? LIMIT 1').get(id) as DbBatchRow | undefined;
    if (!row) {
      return reply.code(404).send({
        success: false,
        error: {
          code: 'ERR_BATCH_NOT_FOUND',
          message: `Batch ${id} not found`,
          userMessage: 'We could not find that batch.',
        },
        requestId,
      });
    }

    if (
      !isOwnerOrAdmin(caller, row.owner_user_id, {
        endpoint: `/api/v1/batches/${id}/cancel`,
        resourceType: 'batch',
        resourceId: id,
        requestId,
      })
    ) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_FORBIDDEN',
          message: 'Access denied to cancel this batch',
          userMessage: 'You do not have permission to cancel this batch.',
        },
        requestId,
      });
    }

    const childJobs = queueService.getBatchJobs(id);
    let cancelledCount = 0;
    for (const job of childJobs) {
      if (!['READY', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(job.status)) {
        await queueService.cancelJob(job.jobId, 'Parent batch cancelled by user').catch(() => {});
        cancelledCount++;
      }
    }

    const updatedRow = db.prepare('SELECT * FROM batches WHERE id = ? LIMIT 1').get(id) as unknown as DbBatchRow;
    return reply.code(200).send({
      success: true,
      data: {
        ...serializeBatchRow(updatedRow),
        cancelledNow: cancelledCount,
      },
      requestId,
    });
  });
};
