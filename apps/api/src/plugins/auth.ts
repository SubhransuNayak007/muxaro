/**
 * MUXARO Media Processing Platform - Authentication & Quota Resolution Plugin
 *
 * Implements user session resolution, tier entitlements (guest, free_account, pro),
 * guest IP hashing, and rolling daily usage / concurrency quotas.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import crypto from 'node:crypto';
import { getDb, users, dailyUsageLedger, mediaJobs, type User, eq, and, sql, inArray } from '@muxaro/db';
import {
  USER_TIERS,
  TIER_CONFIGS,
  type UserTier,
  type TierLimits,
  MuxaroError,
} from '@muxaro/shared';
import { extractClientIp, hashIp } from './rate-limiter.js';

export interface UserSessionPayload {
  id: string;
  email: string | null;
  tier: UserTier;
  displayName: string | null;
}

export interface UserQuotaState {
  remainingJobsToday: number;
  concurrentActiveJobs: number;
  maxUploadSizeBytes: number;
  dailyJobLimit: number;
  maxConcurrentJobs: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserSessionPayload | null;
    tier: UserTier;
    subjectKey: string;
    guestIpHash: string;
    tierLimits: TierLimits;
    quota: UserQuotaState;
  }
}

function extractCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  const prefix = `${cookieName}=`;
  for (const rawCookie of cookieHeader.split(';')) {
    const cookie = rawCookie.trim();
    if (cookie.startsWith(prefix)) {
      const rawVal = cookie.substring(prefix.length).trim();
      if (!rawVal) return null;
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return null;
}

/**
 * Extracts session token from Authorization header or cookie
 */
function extractToken(req: FastifyRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) return token;
  }

  return extractCookieValue(req.headers.cookie, 'muxaro_session');
}

const GUEST_COOKIE_RE = /^guest_[a-f0-9]{16,64}$/i;

const authPluginCallback: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const clientIp = extractClientIp(request);
    const guestCookie = extractCookieValue(request.headers.cookie, 'muxaro_guest');
    const stableGuestSeed =
      guestCookie && GUEST_COOKIE_RE.test(guestCookie) ? guestCookie : clientIp;
    const guestIpHash = hashIp(stableGuestSeed);
    request.guestIpHash = guestIpHash;

    let resolvedUser: UserSessionPayload | null = null;

    // 1. Direct user-id override header (internal services, admin tooling, testing)
    const directUserId = request.headers['x-user-id'];
    if (typeof directUserId === 'string' && directUserId.length > 0) {
      try {
        const [foundUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, directUserId))
          .limit(1);

        if (foundUser) {
          const tier = (USER_TIERS.includes(foundUser.tier as UserTier)
            ? foundUser.tier
            : 'free_account') as UserTier;

          resolvedUser = {
            id: foundUser.id,
            email: foundUser.email,
            tier,
            displayName: foundUser.displayName,
          };
        }
      } catch {
        // Fallback to guest
      }
    }

    // 2. Token-based session resolution
    if (!resolvedUser) {
      const token = extractToken(request);
      if (token) {
        try {
          // If token is UUID, direct user lookup
          const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              token
            );

          if (isUuid) {
            const [foundUser] = await db
              .select()
              .from(users)
              .where(eq(users.id, token))
              .limit(1);

            if (foundUser) {
              const tier = (USER_TIERS.includes(foundUser.tier as UserTier)
                ? foundUser.tier
                : 'free_account') as UserTier;

              resolvedUser = {
                id: foundUser.id,
                email: foundUser.email,
                tier,
                displayName: foundUser.displayName,
              };
            }
          }
        } catch {
          // Fallback to guest
        }
      }
    }

    // 3. Populate request context
    if (resolvedUser) {
      request.user = resolvedUser;
      request.tier = resolvedUser.tier;
      request.subjectKey = `user:${resolvedUser.id}`;
    } else {
      request.user = null;
      request.tier = 'guest';
      request.subjectKey = `guest:${guestIpHash}`;
    }

    const limits = TIER_CONFIGS[request.tier] || TIER_CONFIGS.guest;
    request.tierLimits = limits;

    // 4. Resolve daily usage & concurrency quotas
    let usedJobsToday = 0;
    let concurrentActiveJobs = 0;

    try {
      // Daily ledger lookup
      const todayStr = new Date().toISOString().split('T')[0];
      const [ledgerRow] = await db
        .select()
        .from(dailyUsageLedger)
        .where(
          and(
            eq(dailyUsageLedger.subjectKey, request.subjectKey),
            sql`${dailyUsageLedger.usageDate} = ${todayStr}::date`
          )
        )
        .limit(1);

      if (ledgerRow) {
        usedJobsToday = ledgerRow.jobsCount || 0;
      }

      // Active concurrency lookup
      const activeCondition = resolvedUser
        ? and(
            eq(mediaJobs.userId, resolvedUser.id),
            inArray(mediaJobs.status, ['pending', 'queued', 'processing'])
          )
        : and(
            eq(mediaJobs.guestIpHash, guestIpHash),
            inArray(mediaJobs.status, ['pending', 'queued', 'processing'])
          );

      const [activeCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(mediaJobs)
        .where(activeCondition);

      concurrentActiveJobs = activeCountRow?.count ?? 0;
    } catch {
      // Database unavailable or tables initializing
      usedJobsToday = 0;
      concurrentActiveJobs = 0;
    }

    request.quota = {
      remainingJobsToday: Math.max(0, limits.dailyJobLimit - usedJobsToday),
      concurrentActiveJobs,
      maxUploadSizeBytes: limits.maxUploadSizeBytes,
      dailyJobLimit: limits.dailyJobLimit,
      maxConcurrentJobs: limits.maxConcurrentJobs,
    };
  });
};

export const authPlugin = fp(authPluginCallback, {
  name: 'muxaro-auth',
});

/**
 * Helper guard ensuring request is from an authenticated user
 */
export function requireAuth(req: FastifyRequest): UserSessionPayload {
  if (!req.user) {
    throw MuxaroError.unauthorized('Authentication required to access this resource');
  }
  return req.user;
}
