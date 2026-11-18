/**
 * Project MUXARO - Google Ad Manager Rewarded Ads & Server-Side Verification Routes
 *
 * GET  /api/v1/rewards/config
 * POST /api/v1/rewards/sessions
 * GET  /api/v1/rewards/sessions/:id
 * POST /api/v1/rewards/sessions/:id/refresh
 * GET  /api/v1/rewards/provider-callback
 * POST /api/v1/rewards/provider-callback
 */

import type { FastifyPluginAsync } from 'fastify';
import { resolveRequestAuth, requireAuth } from '../middleware/auth.middleware.js';
import { rewardsService } from '../services/rewards.service.js';

export const rewardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/rewards/config
  fastify.get('/rewards/config', {
    schema: {
      description:
        'Returns real rewarded-ad inventory & policy status. Never reports active unless Google Ad Manager config is genuinely present.',
      tags: ['Rewarded Credits'],
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const auth = resolveRequestAuth(request, reply);
    const cfg = rewardsService.getRewardConfig(auth.authenticated && auth.user ? auth.user.id : null);

    return reply.code(200).send({
      success: true,
      data: {
        ...cfg,
        rewardExpiryHours: cfg.expiryHours,
      },
      requestId,
    });
  });

  // POST /api/v1/rewards/sessions
  fastify.post('/rewards/sessions', {
    schema: {
      description:
        'Creates a server-side reward session bound to the authenticated user (max 1 active pending session, max 3 verified ads / 24h).',
      tags: ['Rewarded Credits'],
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const auth = await requireAuth(request, reply);
    if (!auth || !auth.user || reply.sent) return;

    try {
      const created = rewardsService.createRewardSession({
        userId: auth.user.id,
        ipAddress: request.ip,
        requestId,
      });

      return reply.code(201).send({
        success: true,
        data: created,
        requestId,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      return reply.code(statusCode).send({
        success: false,
        error: {
          code: err.code || 'ERR_REWARD_SESSION_CREATE_FAILED',
          message: err.message || 'Could not start rewarded advertisement session.',
          details: err.details || null,
        },
        requestId,
      });
    }
  });

  // GET /api/v1/rewards/sessions/:id
  fastify.get('/rewards/sessions/:id', {
    schema: {
      description:
        'Returns authoritative server-side status of a reward session (strict owner check; never grants credits).',
      tags: ['Rewarded Credits'],
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
    const auth = await requireAuth(request, reply);
    if (!auth || !auth.user || reply.sent) return;

    const { id } = request.params as { id: string };

    try {
      const session = await rewardsService.getRewardSession({
        sessionId: id,
        userId: auth.user.id,
        ipAddress: request.ip,
        requestId,
      });

      return reply.code(200).send({
        success: true,
        data: session,
        requestId,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      return reply.code(statusCode).send({
        success: false,
        error: {
          code: err.code || 'ERR_REWARD_SESSION_FETCH_FAILED',
          message: err.message || 'Could not retrieve reward session.',
          details: err.details || null,
        },
        requestId,
      });
    }
  });

  // POST /api/v1/rewards/sessions/:id/refresh
  // Explicitly NEVER grants credits from client calls or `rewarded: true` flags!
  fastify.post('/rewards/sessions/:id/refresh', {
    schema: {
      description:
        'Refreshes server-side reward verification status (strict owner check; client payloads can never grant credits).',
      tags: ['Rewarded Credits'],
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
    const auth = await requireAuth(request, reply);
    if (!auth || !auth.user || reply.sent) return;

    const { id } = request.params as { id: string };

    // Explicitly reject forged client-side grant attempts (defense-in-depth audit)
    const body = (request.body || {}) as Record<string, unknown>;
    if (
      body &&
      typeof body === 'object' &&
      (body.rewarded === true ||
        body.grant === true ||
        body.forceVerify === true ||
        body.status === 'VERIFIED' ||
        body.creditsGranted !== undefined)
    ) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_CLIENT_REWARD_FORBIDDEN',
          message:
            'Rewarded credits cannot be granted from client requests. Credits are only awarded after verified provider SSV callback.',
          details: null,
        },
        requestId,
      });
    }

    try {
      const session = await rewardsService.getRewardSession({
        sessionId: id,
        userId: auth.user.id,
        ipAddress: request.ip,
        requestId,
      });

      return reply.code(200).send({
        success: true,
        data: {
          ...session,
          message:
            session.status === 'VERIFIED'
              ? `Verified! +${session.creditsGranted} extra individual credits added to your account.`
              : session.status === 'PENDING'
                ? 'Waiting for server-side ad verification callback.'
                : session.status === 'EXPIRED'
                  ? 'This reward session expired before verification completed.'
                  : 'This reward session could not be verified.',
        },
        requestId,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      return reply.code(statusCode).send({
        success: false,
        error: {
          code: err.code || 'ERR_REWARD_SESSION_REFRESH_FAILED',
          message: err.message || 'Could not refresh reward session.',
          details: err.details || null,
        },
        requestId,
      });
    }
  });

  // GET /api/v1/rewards/provider-callback (Google Ad Manager / AdMob SSV GET specification)
  fastify.get('/rewards/provider-callback', {
    schema: {
      description:
        'Google Ad Manager Rewarded Ads Server-Side Verification (SSV) GET callback endpoint verified via ECDSA-SHA256.',
      tags: ['Rewarded Credits'],
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const rawUrl = request.raw.url || request.url || '';
    const qIdx = rawUrl.indexOf('?');
    const rawQueryString = qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '';
    const queryParams = (request.query || {}) as Record<string, unknown>;

    try {
      const result = await rewardsService.verifyAndProcessProviderCallback({
        method: 'GET',
        rawUrl,
        rawQueryString,
        params: queryParams,
        ipAddress: request.ip,
        requestId,
      });

      return reply.code(result.statusCode).send({
        success: true,
        data: result,
        requestId,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 403;
      return reply.code(statusCode).send({
        success: false,
        error: {
          code: err.code || 'ERR_REWARD_CALLBACK_REJECTED',
          message: err.message || 'Reward verification callback rejected.',
          details: err.details || null,
        },
        requestId,
      });
    }
  });

  // POST /api/v1/rewards/provider-callback (Signed JSON SSV callback support)
  fastify.post('/rewards/provider-callback', {
    schema: {
      description:
        'Google Ad Manager Rewarded Ads Server-Side Verification (SSV) POST JSON callback endpoint verified via ECDSA-SHA256.',
      tags: ['Rewarded Credits'],
    },
  }, async (request, reply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const bodyParams =
      request.body && typeof request.body === 'object'
        ? (request.body as Record<string, unknown>)
        : {};

    try {
      const result = await rewardsService.verifyAndProcessProviderCallback({
        method: 'POST',
        params: bodyParams,
        ipAddress: request.ip,
        requestId,
      });

      return reply.code(result.statusCode).send({
        success: true,
        data: result,
        requestId,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 403;
      return reply.code(statusCode).send({
        success: false,
        error: {
          code: err.code || 'ERR_REWARD_CALLBACK_REJECTED',
          message: err.message || 'Reward verification callback rejected.',
          details: err.details || null,
        },
        requestId,
      });
    }
  });
};

export const rewardsRoutes = rewardRoutes;
