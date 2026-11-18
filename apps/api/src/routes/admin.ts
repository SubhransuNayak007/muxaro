/**
 * Project MUXARO - Administration, SRE Metrics & Control Centre Routes
 *
 * Public redacted health summary (preserved for /status):
 *   GET   /api/v1/admin/metrics
 *
 * Strictly protected by `requireAdminMfa` (authenticated `admin` role + verified TOTP MFA + CSRF):
 *   GET   /api/v1/admin/search?q=
 *   GET   /api/v1/admin/users
 *   POST  /api/v1/admin/users/:publicUserId/suspend
 *   POST  /api/v1/admin/users/:publicUserId/restore
 *   POST  /api/v1/admin/users/:publicUserId/revoke-sessions
 *   GET   /api/v1/admin/settings
 *   PATCH /api/v1/admin/settings
 *   GET   /api/v1/admin/rewards
 *   GET   /api/v1/admin/analytics
 *   GET   /api/v1/admin/audit-logs
 *   GET   /api/v1/admin/security-events
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { queueService } from '../services/queue.service.js';
import { adminService, type AdminActor } from '../services/admin.service.js';
import { rateLimitService } from '../services/ratelimit.service.js';
import { requireAdminMfa, resolveRequestAuth } from '../middleware/auth.middleware.js';

function getAdminActor(request: FastifyRequest): AdminActor {
  const auth = resolveRequestAuth(request);
  return {
    userId: auth.user?.id || 'unknown',
    publicUserId: auth.user?.publicUserId || 'ADMIN',
    email: auth.user?.email,
  };
}

async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  // Ensure env-configured bootstrap admin promotion is synced before role verification
  adminService.syncBootstrapAdminFromEnv();
  const auth = await requireAdminMfa(request, reply);
  if (!auth || reply.sent) return;

  // Apply admin endpoint rate limit (60 / min / admin)
  const rl = rateLimitService.checkPolicy('admin_api', `admin:${auth.user!.id}`, {
    userId: auth.user!.id,
    publicUserId: auth.user!.publicUserId,
    ip: request.ip,
    endpoint: `${request.method} ${request.url.split('?')[0]}`,
    requestId: request.id as string,
  });
  rateLimitService.applyHeaders(reply, rl);
  if (!rl.allowed) {
    return rateLimitService.sendRateLimitExceeded(request, reply, rl);
  }
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // =========================================================================
  // PUBLIC REDACTED OPERATIONAL HEALTH SUMMARY (preserves /status page)
  // =========================================================================
  fastify.get(
    '/admin/metrics',
    {
      schema: {
        description:
          'Public redacted system health summary: queue depth, worker availability, error rates',
        tags: ['Administration & SRE'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const metrics = queueService.getMetrics();
      const mem = process.memoryUsage();

      return reply.code(200).send({
        success: true,
        data: {
          ...metrics,
          system: {
            uptimeSeconds: Math.round(process.uptime()),
            memory: {
              rssMb: Math.round(mem.rss / 1024 / 1024),
              heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
              heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
            },
            nodeVersion: process.version.split('.')[0] + '.x',
          },
        },
        requestId,
      });
    }
  );

  // =========================================================================
  // PROTECTED ADMIN CONTROL CENTRE ROUTES (requireAdminMfa + CSRF + Audit)
  // =========================================================================

  // GET /api/v1/admin/search?q=
  fastify.get(
    '/admin/search',
    {
      preHandler: adminGuard,
      schema: {
        description:
          'Unified support search by Public User ID (MXR-...), Batch ID (MXB-...), Job ID (MXJ-...), or Request ID (req_...)',
        tags: ['Administration & SRE'],
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const { q = '' } = (request.query || {}) as { q?: string };
      const result = adminService.searchSupport(String(q));

      return reply.code(200).send({
        success: true,
        data: result,
        requestId,
      });
    }
  );

  // GET /api/v1/admin/users
  fastify.get(
    '/admin/users',
    {
      preHandler: adminGuard,
      schema: {
        description: 'List registered user accounts with usage, active sessions, credits, and abuse flags',
        tags: ['Administration & SRE'],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', default: 1 },
            limit: { type: 'integer', default: 25 },
            status: { type: 'string' },
            tier: { type: 'string' },
            search: { type: 'string' },
            q: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const query = (request.query || {}) as {
        page?: number;
        limit?: number;
        status?: string;
        tier?: string;
        search?: string;
        q?: string;
      };
      const result = adminService.listUsers({
        ...query,
        search: query.search || query.q,
      });

      return reply.code(200).send({
        success: true,
        data: result,
        requestId,
      });
    }
  );

  // POST /api/v1/admin/users/:publicUserId/suspend
  fastify.post(
    '/admin/users/:publicUserId/suspend',
    {
      preHandler: adminGuard,
      schema: {
        description: 'Suspend a user account by Public User ID and revoke all active sessions',
        tags: ['Administration & SRE'],
        params: {
          type: 'object',
          required: ['publicUserId'],
          properties: {
            publicUserId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const { publicUserId } = request.params as { publicUserId: string };
      const body = (request.body || {}) as { reason?: string };
      const actor = getAdminActor(request);

      const data = adminService.suspendUser(
        publicUserId,
        actor,
        typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : 'Suspended by administrator',
        requestId
      );

      return reply.code(200).send({
        success: true,
        data,
        requestId,
      });
    }
  );

  // POST /api/v1/admin/users/:publicUserId/restore
  fastify.post(
    '/admin/users/:publicUserId/restore',
    {
      preHandler: adminGuard,
      schema: {
        description: 'Restore a suspended user account by Public User ID',
        tags: ['Administration & SRE'],
        params: {
          type: 'object',
          required: ['publicUserId'],
          properties: {
            publicUserId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const { publicUserId } = request.params as { publicUserId: string };
      const body = (request.body || {}) as { reason?: string };
      const actor = getAdminActor(request);

      const data = adminService.restoreUser(
        publicUserId,
        actor,
        typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : 'Restored by administrator',
        requestId
      );

      return reply.code(200).send({
        success: true,
        data,
        requestId,
      });
    }
  );

  // POST /api/v1/admin/users/:publicUserId/revoke-sessions
  fastify.post(
    '/admin/users/:publicUserId/revoke-sessions',
    {
      preHandler: adminGuard,
      schema: {
        description: 'Revoke all active sessions for a user account by Public User ID',
        tags: ['Administration & SRE'],
        params: {
          type: 'object',
          required: ['publicUserId'],
          properties: {
            publicUserId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const { publicUserId } = request.params as { publicUserId: string };
      const body = (request.body || {}) as { reason?: string };
      const actor = getAdminActor(request);

      const data = adminService.revokeUserSessions(
        publicUserId,
        actor,
        typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : 'Sessions revoked by administrator',
        requestId
      );

      return reply.code(200).send({
        success: true,
        data,
        requestId,
      });
    }
  );

  // GET /api/v1/admin/settings
  fastify.get(
    '/admin/settings',
    {
      preHandler: adminGuard,
      schema: {
        description: 'Retrieve configurable quota, concurrency, upload, and rewarded ad settings',
        tags: ['Administration & SRE'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const data = adminService.getSettings();

      return reply.code(200).send({
        success: true,
        data,
        requestId,
      });
    }
  );

  // PATCH /api/v1/admin/settings
  fastify.patch(
    '/admin/settings',
    {
      preHandler: adminGuard,
      schema: {
        description:
          'Update configurable platform settings with bounds validation and immutable audit logging',
        tags: ['Administration & SRE'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const body = (request.body || {}) as Record<string, unknown>;
      const actor = getAdminActor(request);
      const data = adminService.updateSettings(body, actor, requestId);

      return reply.code(200).send({
        success: true,
        data,
        requestId,
      });
    }
  );

  // GET /api/v1/admin/rewards
  fastify.get(
    '/admin/rewards',
    {
      preHandler: adminGuard,
      schema: {
        description: 'Rewarded ads provider status, verified/rejected callback counts, and fraud flags',
        tags: ['Administration & SRE'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const data = adminService.getRewardsOverview();

      return reply.code(200).send({
        success: true,
        data,
        requestId,
      });
    }
  );

  // GET /api/v1/admin/analytics
  fastify.get(
    '/admin/analytics',
    {
      preHandler: adminGuard,
      schema: {
        description:
          'Real DB-derived business analytics: DAU/MAU, registrations, jobs, downloads, rewards, retention, funnel, tier queue latency',
        tags: ['Administration & SRE'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const data = adminService.getAnalytics();

      return reply.code(200).send({
        success: true,
        data,
        requestId,
      });
    }
  );

  // GET /api/v1/admin/audit-logs
  fastify.get(
    '/admin/audit-logs',
    {
      preHandler: adminGuard,
      schema: {
        description: 'Immutable audit log of all administrative actions',
        tags: ['Administration & SRE'],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', default: 1 },
            limit: { type: 'integer', default: 50 },
            action: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const query = (request.query || {}) as { page?: number; limit?: number; action?: string };
      const data = adminService.getAuditLogs(query);

      return reply.code(200).send({
        success: true,
        data,
        requestId,
      });
    }
  );

  // GET /api/v1/admin/security-events
  fastify.get(
    '/admin/security-events',
    {
      preHandler: adminGuard,
      schema: {
        description: 'Redacted structured security event log (brute force, rate-limit spikes, IDOR, reward replays)',
        tags: ['Administration & SRE'],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', default: 1 },
            limit: { type: 'integer', default: 50 },
            eventType: { type: 'string' },
            severity: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const query = (request.query || {}) as {
        page?: number;
        limit?: number;
        eventType?: string;
        severity?: string;
      };
      const data = adminService.getSecurityEvents(query);

      return reply.code(200).send({
        success: true,
        data,
        requestId,
      });
    }
  );
};
