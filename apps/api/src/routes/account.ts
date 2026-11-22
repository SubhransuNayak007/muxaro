/**
 * MUXARO Media Processing Platform - Account Quota, Credits & History Routes
 *
 * GET /api/v1/account/credits
 * GET /api/v1/account/history
 * GET /v1/account/credits
 * GET /v1/account/history
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDb, mediaJobs, eq, desc } from '@muxaro/db';

export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // GET /account/credits
  fastify.get('/account/credits', async (request: FastifyRequest, reply: FastifyReply) => {
    const limits = request.tierLimits;
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const resetSeconds = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 1000));

    const totalAllowed = limits.dailyJobLimit; // 100 for guest
    const remaining = request.quota.remainingJobsToday;
    const used = Math.max(0, totalAllowed - remaining);

    const payload = {
      tier: request.tier,
      tierLabel: request.tier === 'pro' ? 'Pro' : request.tier === 'free_account' ? 'Free Account' : 'Guest',
      remainingAllowance: remaining,
      dailyAllowance: totalAllowed,
      usedAllowance: used,
      concurrencyLimit: limits.maxConcurrentJobs,
      concurrencyInUse: request.quota.concurrentActiveJobs,
      extraCredits: 0,
      totalAvailableCredits: remaining,
      resetSecondsRemaining: resetSeconds,
      formattedResetCountdown: `${Math.floor(resetSeconds / 3600)}h ${Math.floor((resetSeconds % 3600) / 60)}m`,
      maxUploadBytes: limits.maxUploadSizeBytes,
      allowedTools: limits.allowedTools,
    };

    return reply.status(200).send({
      success: true,
      data: payload,
      ...payload,
      requestId: request.id,
    });
  });

  // GET /account/history
  fastify.get('/account/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query || {}) as { page?: string; limit?: string };
    const page = Math.max(1, Number.parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    let jobsList: any[] = [];
    try {
      if (request.user?.id) {
        jobsList = await db
          .select()
          .from(mediaJobs)
          .where(eq(mediaJobs.userId, request.user.id))
          .orderBy(desc(mediaJobs.createdAt))
          .limit(limit)
          .offset(offset);
      } else {
        jobsList = await db
          .select()
          .from(mediaJobs)
          .where(eq(mediaJobs.guestIpHash, request.guestIpHash))
          .orderBy(desc(mediaJobs.createdAt))
          .limit(limit)
          .offset(offset);
      }
    } catch {
      jobsList = [];
    }

    const items = (jobsList || []).map((j: any) => ({
      id: j.id,
      jobId: j.id,
      status: j.status || 'queued',
      tool: j.tool,
      operation: j.operation,
      progress: j.progress || 0,
      targetFormat: j.targetFormat,
      targetResolution: j.targetResolution,
      sourceUrl: j.sourceUrl,
      downloadUrl: j.downloadUrl,
      error: j.errorMessage ? { message: j.errorMessage, code: j.errorCode } : null,
      userMessage: j.errorMessage || null,
      retentionPolicy: j.retentionPolicy,
      expiresAt: j.retentionExpiresAt,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    }));

    return reply.status(200).send({
      success: true,
      data: {
        total: items.length,
        page,
        limit,
        jobs: items,
      },
      jobs: items,
      requestId: request.id,
    });
  });
};
