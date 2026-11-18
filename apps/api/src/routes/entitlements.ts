/**
 * Project MUXARO - Entitlements, Credits & Immutable Ledger Routes
 *
 * GET /api/v1/entitlements
 * GET /api/v1/entitlements/usage
 * GET /api/v1/credits
 * GET /api/v1/credits/ledger
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { resolveRequestAuth } from '../middleware/auth.middleware.js';
import {
  entitlementsService,
  type CreditLedgerEntryType,
  type UnifiedQuotaStatus,
} from '../services/entitlements.service.js';

export async function resolveQuotaActor(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{
  userId: string;
  tier: string;
  role: string;
  authenticated: boolean;
}> {
  const auth = resolveRequestAuth(request, reply);
  if (auth.authenticated && auth.user) {
    return {
      userId: auth.user.id,
      tier: auth.user.tier,
      role: auth.user.role,
      authenticated: true,
    };
  }

  // Backwards compatibility for legacy Bearer `usr_*` / `session_*` integration tests
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && /^Bearer\s+(usr_|session_)/i.test(authHeader.trim())) {
    const { session } = await entitlementsService.resolveSession(
      authHeader,
      request.ip || '127.0.0.1',
      request.headers['user-agent']
    );
    return {
      userId: session.userId,
      tier: session.tier,
      role: session.role,
      authenticated: false,
    };
  }

  return {
    userId: auth.guestId,
    tier: 'guest',
    role: 'anonymous',
    authenticated: false,
  };
}

export function serializeUnifiedQuotaPayload(status: UnifiedQuotaStatus) {
  const tierLower = status.tier.toLowerCase();
  return {
    // Unified account-platform contract
    tier: tierLower,
    accountTier: status.tier,
    queuePriority: status.queuePriority,
    maxConcurrentJobs: status.maxConcurrentJobs,
    baseLimit: status.baseLimit,
    baseUsed: status.baseUsed,
    baseRemaining: status.baseRemaining,
    extraCreditsEarned: status.extraCreditsEarned,
    extraCreditsRemaining: status.extraCreditsRemaining,
    extraCreditsExpiresAt: status.extraCreditsExpiresAt,
    totalAvailableIndividual: status.totalAvailableIndividual,
    maxIndividualWithRewards: status.maxIndividualWithRewards,
    rewardedAdsUsedToday: status.rewardedAdsUsedToday,
    rewardedAdsDailyCap: status.rewardedAdsDailyCap,
    remainingRewardedAdsToday: status.remainingRewardedAdsToday,
    playlistJobsLimit: status.playlistJobsLimit,
    playlistJobsUsed: status.playlistJobsUsed,
    playlistJobsRemaining: status.playlistJobsRemaining,
    maxPlaylistItems: status.maxPlaylistItems,
    rollingWindowHours: status.rollingWindowHours,
    resetCountdownSeconds: status.resetCountdownSeconds,
    nextResetIso: status.nextResetIso,
    playlistResetCountdownSeconds: status.playlistResetCountdownSeconds,
    playlistNextResetIso: status.playlistNextResetIso,
    evaluatedAt: status.evaluatedAt,

    // QuotaStatus frontend aliases
    individualVideosLimit: status.baseLimit,
    individualVideosRemaining: status.totalAvailableIndividual,

    // Legacy nested /account/credits compatibility
    individualVideos: {
      allowance: status.baseLimit,
      consumed: status.baseUsed,
      remaining: status.totalAvailableIndividual,
      baseRemaining: status.baseRemaining,
      extraCreditsRemaining: status.extraCreditsRemaining,
      windowSeconds: status.windowSeconds,
      nextResetAt: status.nextResetIso,
      secondsUntilNextSlot: status.resetCountdownSeconds,
    },
    playlists: {
      allowance: status.playlistJobsLimit,
      consumed: status.playlistJobsUsed,
      remaining: status.playlistJobsRemaining,
      maxItemsPerPlaylist: status.maxPlaylistItems,
      nextResetAt: status.playlistNextResetIso,
      secondsUntilNextSlot: status.playlistResetCountdownSeconds,
    },
    credits: {
      balance: status.extraCreditsRemaining,
      earned24h: status.extraCreditsEarned,
      expiresAt: status.extraCreditsExpiresAt,
      currency: 'INDIVIDUAL_CREDITS',
    },
  };
}

const VALID_LEDGER_TYPES = new Set<CreditLedgerEntryType>([
  'REWARD_GRANTED',
  'CREDIT_RESERVED',
  'CREDIT_CONSUMED',
  'CREDIT_RELEASED',
  'ADMIN_ADJUSTMENT',
  'CREDIT_EXPIRED',
]);

export const entitlementRoutes: FastifyPluginAsync = async (fastify) => {
  const handleQuotaSnapshot = async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const actor = await resolveQuotaActor(request, reply);
    const status = await entitlementsService.getQuotaStatus(actor.userId, actor.tier, actor.role);

    return reply.code(200).send({
      success: true,
      data: serializeUnifiedQuotaPayload(status),
      requestId,
    });
  };

  // GET /api/v1/entitlements
  fastify.get('/entitlements', {
    schema: {
      description: 'Get live account entitlements, concurrency caps, priority tier, and rolling 24h quotas',
      tags: ['Account & Quota'],
    },
  }, handleQuotaSnapshot);

  // GET /api/v1/entitlements/usage
  fastify.get('/entitlements/usage', {
    schema: {
      description: 'Get live rolling 24-hour usage breakdown, extra rewarded credits, and reset timers',
      tags: ['Account & Quota'],
    },
  }, handleQuotaSnapshot);

  // GET /api/v1/credits
  fastify.get('/credits', {
    schema: {
      description: 'Get live account credit balances (base allowance + unexpired extra rewarded credits)',
      tags: ['Account & Quota'],
    },
  }, handleQuotaSnapshot);

  // GET /api/v1/credits/ledger
  fastify.get('/credits/ledger', {
    schema: {
      description:
        'Get immutable audit ledger of rewarded credit grants, job reservations, consumptions, releases, and expirations',
      tags: ['Account & Quota'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 },
          type: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const actor = await resolveQuotaActor(request, reply);
    const query = (request.query || {}) as { limit?: number; offset?: number; type?: string };

    const rawType = typeof query.type === 'string' ? query.type.trim().toUpperCase() : undefined;
    const entryType =
      rawType && VALID_LEDGER_TYPES.has(rawType as CreditLedgerEntryType)
        ? (rawType as CreditLedgerEntryType)
        : undefined;

    const ledger = await entitlementsService.getLedger(actor.userId, {
      limit: query.limit,
      offset: query.offset,
      entryType,
    });

    const items = ledger.items.map((item) => ({
      id: item.id,
      entryType: item.entryType,
      eventType: item.entryType,
      delta: item.delta,
      change: item.change,
      remainingDelta: item.remainingDelta,
      balanceAfter: item.balanceAfter,
      referenceId: item.referenceId || '',
      reason: item.reason,
      operation: item.operation,
      expiresAt: item.expiresAt,
      createdAt: item.createdAt,
      timestamp: item.timestamp,
    }));

    return reply.code(200).send({
      success: true,
      data: items,
      meta: {
        total: ledger.total,
        limit: ledger.limit,
        offset: ledger.offset,
      },
      requestId,
    });
  });
};

export const entitlementsRoutes = entitlementRoutes;
