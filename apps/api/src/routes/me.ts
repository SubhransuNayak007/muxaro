/**
 * Project MUXARO - Authenticated User Profile, Identity & Session Management Routes
 *
 * Mounted under /api/v1:
 * - GET    /api/v1/me
 * - PATCH  /api/v1/me
 * - DELETE /api/v1/me
 * - GET    /api/v1/me/identity
 * - GET    /api/v1/me/sessions
 * - DELETE /api/v1/me/sessions/:sessionId
 */

import '@fastify/swagger';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { authService, type AuthServiceError } from '../services/auth.service.js';
import {
  clearAuthCookies,
  isSecureRequest,
  requireAuth,
} from '../middleware/auth.middleware.js';

function handleMeError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const requestId = (request.id as string) || `req_${Date.now()}`;
  const authErr = err as Partial<AuthServiceError>;
  const statusCode =
    typeof authErr?.statusCode === 'number' && authErr.statusCode >= 400
      ? authErr.statusCode
      : 500;
  const code = authErr?.code || 'ERR_INTERNAL_SERVER';
  const message =
    statusCode >= 500
      ? 'An unexpected account error occurred.'
      : authErr?.message || 'Account operation failed.';

  return reply.code(statusCode).send({
    success: false,
    error: {
      code,
      message,
      details: authErr?.details ?? null,
    },
    requestId,
  });
}

export const meRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/me
  fastify.get(
    '/me',
    {
      schema: {
        description: 'Get authenticated user profile, preferences, and live job/session summary',
        tags: ['Account & Identity'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user || !auth.session) return;

      try {
        const profile = authService.getUserProfile(auth.user.id, auth.session.mfaVerified);
        return reply.code(200).send({
          success: true,
          data: profile,
          requestId,
        });
      } catch (err) {
        return handleMeError(err, request, reply);
      }
    }
  );

  // PATCH /api/v1/me
  fastify.patch(
    '/me',
    {
      schema: {
        description: 'Update authenticated user display name or preferences',
        tags: ['Account & Identity'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user || !auth.session) return;

      try {
        const body = (request.body || {}) as {
          displayName?: string;
          preferences?: Record<string, unknown>;
        };
        const updated = authService.updateUserProfile(
          auth.user.id,
          { displayName: body.displayName, preferences: body.preferences },
          auth.session.mfaVerified
        );

        return reply.code(200).send({
          success: true,
          data: updated,
          requestId,
        });
      } catch (err) {
        return handleMeError(err, request, reply);
      }
    }
  );

  // DELETE /api/v1/me
  fastify.delete(
    '/me',
    {
      schema: {
        description: 'Soft-delete authenticated account and revoke all active sessions',
        tags: ['Account & Identity'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user) return;

      try {
        const result = authService.softDeleteUser(auth.user.id, request.ip, requestId);
        clearAuthCookies(reply, isSecureRequest(request));

        return reply.code(200).send({
          success: true,
          data: {
            deleted: result.deleted,
            sessionsRevoked: result.sessionsRevoked,
            message: 'Your account has been deleted and all active sessions were revoked.',
          },
          requestId,
        });
      } catch (err) {
        return handleMeError(err, request, reply);
      }
    }
  );

  // GET /api/v1/me/identity
  fastify.get(
    '/me/identity',
    {
      schema: {
        description: 'Get customer-safe identity summary including Public User ID (MXR-XXXXXXXX)',
        tags: ['Account & Identity'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user || !auth.session) return;

      return reply.code(200).send({
        success: true,
        data: {
          id: auth.user.id,
          publicUserId: auth.user.publicUserId,
          memberSince: auth.user.createdAt,
          emailVerified: auth.user.emailVerified,
          tier: auth.user.tier,
          role: auth.user.role,
          mfaEnabled: auth.user.mfaEnabled,
          mfaVerified: auth.session.mfaVerified,
        },
        requestId,
      });
    }
  );

  // GET /api/v1/me/sessions
  fastify.get(
    '/me/sessions',
    {
      schema: {
        description: 'List active sessions and devices for the authenticated user',
        tags: ['Account & Identity'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user || !auth.session) return;

      try {
        const sessions = authService.listActiveSessions(auth.user.id, auth.session.id);
        return reply.code(200).send({
          success: true,
          data: {
            sessions,
            total: sessions.length,
          },
          requestId,
        });
      } catch (err) {
        return handleMeError(err, request, reply);
      }
    }
  );

  // DELETE /api/v1/me/sessions/:sessionId
  fastify.delete(
    '/me/sessions/:sessionId',
    {
      schema: {
        description: 'Revoke a specific session belonging to the authenticated user (IDOR protected)',
        tags: ['Account & Identity'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user || !auth.session) return;

      try {
        const params = request.params as { sessionId: string };
        const sessionId = String(params.sessionId || '').trim();
        if (!sessionId) {
          return reply.code(400).send({
            success: false,
            error: {
              code: 'ERR_INVALID_SESSION_ID',
              message: 'Session ID is required.',
              details: null,
            },
            requestId,
          });
        }

        authService.revokeSessionById({
          sessionId,
          ownerUserId: auth.user.id,
          ipAddress: request.ip,
          requestId,
        });

        const revokedCurrent = sessionId === auth.session.id;
        if (revokedCurrent) {
          clearAuthCookies(reply, isSecureRequest(request));
        }

        return reply.code(200).send({
          success: true,
          data: {
            revoked: true,
            sessionId,
            revokedCurrent,
          },
          requestId,
        });
      } catch (err) {
        return handleMeError(err, request, reply);
      }
    }
  );
};
