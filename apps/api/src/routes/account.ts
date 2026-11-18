/**
 * Project MUXARO - Account Quota, Credits & History Routes
 *
 * GET /api/v1/account/credits
 * GET /api/v1/account/history
 * (Immutable /api/v1/credits/ledger is served by routes/entitlements.ts)
 */

import type { FastifyPluginAsync } from 'fastify';
import { entitlementsService } from '../services/entitlements.service.js';
import { queueService } from '../services/queue.service.js';
import { resolveQuotaActor, serializeUnifiedQuotaPayload } from './entitlements.js';

export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/account/credits
  fastify.get('/account/credits', {
    schema: {
      description:
        'Get transparent rolling 24-hour quota allowances, extra rewarded credits, and live reset countdown timers',
      tags: ['Account & Quota'],
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const actor = await resolveQuotaActor(request, reply);
    const status = await entitlementsService.getQuotaStatus(actor.userId, actor.tier, actor.role);

    return reply.code(200).send({
      success: true,
      data: serializeUnifiedQuotaPayload(status),
      requestId,
    });
  });

  // GET /api/v1/account/history
  fastify.get('/account/history', {
    schema: {
      description: 'Get paginated history of jobs owned by the current authenticated account or guest session',
      tags: ['Account & Quota'],
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

    const actor = await resolveQuotaActor(request, reply);
    const { items, total } = queueService.getUserJobs(actor.userId, limit, offset);

    return reply.code(200).send({
      success: true,
      data: {
        total,
        page,
        limit,
        jobs: items.map((j) => {
          const rec = j as any;
          return {
            id: j.jobId,
            jobId: j.jobId,
            batchId: rec.batchId || null,
            itemNumber: rec.itemNumber || null,
            status: j.status,
            operation: j.operation,
            progress: j.progress,
            stage: j.stage || j.status,
            stageMessage: j.stageMessage || '',
            inputTitle: j.inputTitle || null,
            targetFormat: j.targetFormat,
            targetResolution: j.targetResolution || null,
            processingLane: j.processingLane || 'smart',
            strategyLabel: j.strategyLabel || 'Media Processing',
            losslessPreserved: j.losslessPreserved ?? false,
            retentionMinutes: j.retentionMinutes ?? 60,
            downloadUrl: j.downloadUrl || null,
            artifact: j.artifact
              ? {
                  artifactId: j.artifact.artifactId,
                  filename: j.artifact.filename,
                  mimeType: j.artifact.mimeType,
                  sizeBytes: j.artifact.sizeBytes,
                  container: j.artifact.container,
                  codec: j.artifact.codec,
                  durationSeconds: j.artifact.durationSeconds,
                  checksumSha256: j.artifact.checksumSha256,
                  downloadUrl: j.artifact.downloadUrl,
                  expiresAt: j.artifact.expiresAt,
                }
              : null,
            error: j.error || null,
            userMessage: j.error?.userMessage || null,
            expiresAt: j.expiresAt || null,
            createdAt: j.createdAt,
            completedAt: j.completedAt || null,
          };
        }),
      },
      requestId,
    });
  });
};
