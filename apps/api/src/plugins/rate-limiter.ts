/**
 * MUXARO Media Processing Platform - Sliding Window Rate Limiter Plugin
 *
 * Implements high-throughput sliding window rate limiting backed by Redis ZSET:
 * - Key topology: muxaro:ratelimit:api:{subject_key}:{route_group}
 * - Subject key: `user:${userId}` for authenticated users, `guest:${sha256(ip)}` for guests
 * - Atomic ZSET evaluation removing expired timestamps and verifying limits
 * - Sets standard RateLimit-* and Retry-After HTTP headers
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import crypto from 'node:crypto';
import { getMuxaroRedis } from '@muxaro/db';
import { MuxaroError } from '@muxaro/shared';

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export const ROUTE_LIMITS: Record<string, Record<string, RateLimitRule>> = {
  analyse: {
    guest: { limit: 15, windowSeconds: 60 },
    free_account: { limit: 30, windowSeconds: 60 },
    pro: { limit: 60, windowSeconds: 60 },
  },
  uploads: {
    guest: { limit: 60, windowSeconds: 60 },
    free_account: { limit: 120, windowSeconds: 60 },
    pro: { limit: 300, windowSeconds: 60 },
  },
  uploads_init: {
    guest: { limit: 20, windowSeconds: 60 },
    free_account: { limit: 40, windowSeconds: 60 },
    pro: { limit: 120, windowSeconds: 60 },
  },
  uploads_part: {
    guest: { limit: 600, windowSeconds: 60 },
    free_account: { limit: 1200, windowSeconds: 60 },
    pro: { limit: 2400, windowSeconds: 60 },
  },
  jobs: {
    guest: { limit: 30, windowSeconds: 60 },
    free_account: { limit: 60, windowSeconds: 60 },
    pro: { limit: 120, windowSeconds: 60 },
  },
  jobs_poll: {
    guest: { limit: 600, windowSeconds: 60 },
    free_account: { limit: 600, windowSeconds: 60 },
    pro: { limit: 1200, windowSeconds: 60 },
  },
  downloads: {
    guest: { limit: 30, windowSeconds: 60 },
    free_account: { limit: 60, windowSeconds: 60 },
    pro: { limit: 120, windowSeconds: 60 },
  },
  status: {
    guest: { limit: 60, windowSeconds: 60 },
    free_account: { limit: 60, windowSeconds: 60 },
    pro: { limit: 120, windowSeconds: 60 },
  },
  usage: {
    guest: { limit: 30, windowSeconds: 60 },
    free_account: { limit: 60, windowSeconds: 60 },
    pro: { limit: 120, windowSeconds: 60 },
  },
  default: {
    guest: { limit: 60, windowSeconds: 60 },
    free_account: { limit: 120, windowSeconds: 60 },
    pro: { limit: 300, windowSeconds: 60 },
  },
};

export function extractClientIp(req: FastifyRequest): string {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
    const firstIp = xForwardedFor.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.length > 0) {
    return xRealIp.trim();
  }
  return req.ip || '127.0.0.1';
}

export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip.trim()).digest('hex');
}

export function resolveRouteGroup(url: string, method?: string): string {
  const cleanPath = url.split('?')[0].toLowerCase();
  if (cleanPath.startsWith('/v1/analyse') || cleanPath.startsWith('/api/v1/analyse')) {
    return 'analyse';
  }
  if (
    /^\/(?:api\/)?v1\/uploads\/init$/.test(cleanPath) ||
    /^\/(?:api\/)?v1\/media\/upload\/init$/.test(cleanPath)
  ) {
    return 'uploads_init';
  }
  if (
    /^\/(?:api\/)?v1\/uploads\/[^/]+\/(?:parts?|complete|abort)/.test(cleanPath) ||
    /^\/(?:api\/)?v1\/media\/upload\/[^/]+\/(?:parts?|complete)/.test(cleanPath)
  ) {
    return 'uploads_part';
  }
  if (cleanPath.startsWith('/v1/uploads') || cleanPath.startsWith('/api/v1/uploads')) {
    return 'uploads';
  }
  if (cleanPath.startsWith('/v1/jobs') || cleanPath.startsWith('/api/v1/jobs')) {
    if (method && method.toUpperCase() === 'GET') {
      return 'jobs_poll';
    }
    return 'jobs';
  }
  if (cleanPath.startsWith('/v1/downloads') || cleanPath.startsWith('/api/v1/downloads')) {
    return 'downloads';
  }
  if (cleanPath.startsWith('/v1/status') || cleanPath.startsWith('/api/v1/status')) {
    return 'status';
  }
  if (cleanPath.startsWith('/v1/usage') || cleanPath.startsWith('/api/v1/usage')) {
    return 'usage';
  }
  return 'default';
}

const rateLimiterPluginCallback: FastifyPluginAsync = async (fastify) => {
  const redis = getMuxaroRedis();

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip health check probes from rate limiting
    const url = request.url.split('?')[0];
    if (url === '/health' || url === '/v1/health' || url === '/_health') {
      return;
    }

    // Ensure subjectKey and guestIpHash are resolved
    if (!request.guestIpHash) {
      const clientIp = extractClientIp(request);
      request.guestIpHash = hashIp(clientIp);
    }

    const subjectKey =
      request.user && request.user.id
        ? `user:${request.user.id}`
        : `guest:${request.guestIpHash}`;

    request.subjectKey = subjectKey;

    if (process.env.RATE_LIMIT_ENABLED === 'false') {
      return;
    }

    const tier = request.tier || 'guest';
    const routeGroup = resolveRouteGroup(request.url, request.method);
    const rule =
      ROUTE_LIMITS[routeGroup]?.[tier] ||
      ROUTE_LIMITS.default[tier] ||
      ROUTE_LIMITS.default.guest;

    try {
      const { allowed, remaining, resetMs } =
        await redis.checkSlidingWindowRateLimit(
          subjectKey,
          routeGroup,
          rule.limit,
          rule.windowSeconds
        );

      const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));

      reply.header('RateLimit-Limit', rule.limit);
      reply.header('RateLimit-Remaining', remaining);
      reply.header('RateLimit-Reset', Math.ceil(resetMs / 1000));

      if (!allowed) {
        reply.header('Retry-After', retryAfterSeconds);
        throw MuxaroError.rateLimited(
          `Rate limit exceeded for ${routeGroup}. Please wait ${retryAfterSeconds}s before retrying.`,
          retryAfterSeconds * 1000
        );
      }
    } catch (err) {
      if (err instanceof MuxaroError) {
        throw err;
      }
      // If Redis rate limit check fails, log warning and let request proceed so cache doesn't block ingress
      request.log.warn({ err }, '[RateLimiter] Error evaluating sliding window rate limit');
    }
  });
};

export const rateLimiterPlugin = fp(rateLimiterPluginCallback, {
  name: 'muxaro-rate-limiter',
});
