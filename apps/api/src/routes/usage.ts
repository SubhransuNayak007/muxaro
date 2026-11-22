/**
 * MUXARO Media Processing Platform - Usage & Entitlements Routes
 *
 * Implements GET /v1/usage reading from daily_usage_ledger and media_jobs concurrency.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDb, dailyUsageLedger, and, eq, sql } from '@muxaro/db';
import type { DailyUsageResponse } from '@muxaro/shared';

export const usageRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.get('/usage', async (request: FastifyRequest, reply: FastifyReply) => {
    const todayStr = new Date().toISOString().split('T')[0];

    let jobsCount = 0;
    let bandwidthBytes = 0;

    try {
      const [row] = await db
        .select()
        .from(dailyUsageLedger)
        .where(
          and(
            eq(dailyUsageLedger.subjectKey, request.subjectKey),
            sql`${dailyUsageLedger.usageDate} = ${todayStr}::date`
          )
        )
        .limit(1);

      if (row) {
        jobsCount = row.jobsCount || 0;
        bandwidthBytes = row.bandwidthBytes || 0;
      }
    } catch {
      // In case database table is empty or connecting
      jobsCount = 0;
      bandwidthBytes = 0;
    }

    const limits = request.tierLimits;
    const bandwidthLimitBytes = limits.maxUploadSizeBytes * Math.max(1, limits.dailyJobLimit);

    const responseData: DailyUsageResponse = {
      subjectKey: request.subjectKey,
      date: todayStr,
      tier: request.tier,
      jobsCount,
      jobsLimit: limits.dailyJobLimit,
      bandwidthBytes,
      bandwidthLimitBytes,
      concurrentActive: request.quota.concurrentActiveJobs,
      concurrentLimit: limits.maxConcurrentJobs,
    };

    return reply.status(200).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });
};
