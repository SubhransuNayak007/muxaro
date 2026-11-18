/**
 * Project MUXARO - Authentication, Session, Google OAuth 2.0 (PKCE) & Admin MFA Routes
 *
 * Mounted under /api/v1:
 * - POST /api/v1/auth/register
 * - POST /api/v1/auth/login
 * - POST /api/v1/auth/verify-email
 * - POST /api/v1/auth/resend-verification
 * - POST /api/v1/auth/forgot-password
 * - POST /api/v1/auth/reset-password
 * - GET  /api/v1/auth/session
 * - POST /api/v1/auth/logout
 * - POST /api/v1/auth/logout-all
 * - GET  /api/v1/auth/google/start
 * - GET  /api/v1/auth/google/callback
 * - POST /api/v1/auth/mfa/setup
 * - POST /api/v1/auth/mfa/verify
 * - POST /api/v1/auth/mfa/disable
 */

import '@fastify/swagger';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  authService,
  type AuthServiceError,
} from '../services/auth.service.js';
import {
  CSRF_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  appendSetCookie,
  clearAuthCookies,
  isSecureRequest,
  parseCookies,
  requireAuth,
  resolveRequestAuth,
  serializeCookie,
  setAuthCookies,
  verifyCsrf,
} from '../middleware/auth.middleware.js';

function handleAuthError(
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
      ? 'An unexpected authentication error occurred.'
      : authErr?.message || 'Authentication request failed.';

  if (typeof authErr?.retryAfterSeconds === 'number' && authErr.retryAfterSeconds > 0) {
    reply.header('Retry-After', String(authErr.retryAfterSeconds));
  }

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

function getFrontendBaseUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/auth/register
  fastify.post(
    '/auth/register',
    {
      schema: {
        description: 'Register a new MUXARO account with email and password',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      try {
        const body = (request.body || {}) as {
          email?: string;
          password?: string;
          displayName?: string;
        };

        const result = await authService.registerWithEmail({
          email: body.email,
          password: body.password,
          displayName: body.displayName,
          userAgent: request.headers['user-agent'] || null,
          ipAddress: request.ip,
          requestId,
        });

        setAuthCookies(reply, result.sessionToken, result.csrfToken, isSecureRequest(request));

        return reply.code(201).send({
          success: true,
          data: {
            authenticated: true,
            user: result.user,
            csrfToken: result.csrfToken,
            verificationRequired: true,
            emailVerificationRequired: true,
            verificationExpiresAt: result.verificationExpiresAt,
            deliveryMode: result.deliveryMode,
            googleAuthConfigured: authService.isGoogleAuthConfigured(),
          },
          requestId,
        });
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // POST /api/v1/auth/login
  fastify.post(
    '/auth/login',
    {
      schema: {
        description: 'Sign in with email and password (supports optional MFA TOTP code)',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      try {
        const body = (request.body || {}) as {
          email?: string;
          password?: string;
          mfaCode?: string;
        };
        const cookies = parseCookies(request.headers.cookie);
        const previousSessionToken = cookies[SESSION_COOKIE_NAME] || null;

        const result = await authService.loginWithEmail({
          email: body.email,
          password: body.password,
          mfaCode: body.mfaCode,
          userAgent: request.headers['user-agent'] || null,
          ipAddress: request.ip,
          previousSessionToken,
          requestId,
        });

        setAuthCookies(reply, result.sessionToken, result.csrfToken, isSecureRequest(request));

        return reply.code(200).send({
          success: true,
          data: {
            authenticated: true,
            mfaRequired: result.mfaRequired,
            user: result.user,
            csrfToken: result.csrfToken,
            googleAuthConfigured: authService.isGoogleAuthConfigured(),
          },
          requestId,
        });
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // POST /api/v1/auth/verify-email
  fastify.post(
    '/auth/verify-email',
    {
      schema: {
        description: 'Verify account email using a single-use 6-digit code or token',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      try {
        const auth = resolveRequestAuth(request, reply);
        if (auth.authenticated && auth.authMethod === 'cookie' && !verifyCsrf(request)) {
          return reply.code(403).send({
            success: false,
            error: {
              code: 'ERR_CSRF_INVALID',
              message: 'Invalid or missing CSRF verification token.',
              details: null,
            },
            requestId,
          });
        }

        const body = (request.body || {}) as { code?: string; token?: string };
        const result = authService.verifyEmail({
          userId: auth.user?.id ?? null,
          code: body.code,
          token: body.token,
          requestId,
        });

        return reply.code(200).send({
          success: true,
          data: {
            verified: result.verified,
            message: 'Your email address has been verified.',
          },
          requestId,
        });
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // POST /api/v1/auth/resend-verification
  fastify.post(
    '/auth/resend-verification',
    {
      schema: {
        description: 'Re-issue a single-use email verification code (anti-enumeration)',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      try {
        const auth = resolveRequestAuth(request, reply);
        if (auth.authenticated && auth.authMethod === 'cookie' && !verifyCsrf(request)) {
          return reply.code(403).send({
            success: false,
            error: {
              code: 'ERR_CSRF_INVALID',
              message: 'Invalid or missing CSRF verification token.',
              details: null,
            },
            requestId,
          });
        }

        const body = (request.body || {}) as { email?: string };
        const result = authService.resendEmailVerification({
          userId: auth.user?.id ?? null,
          email: body.email,
        });

        return reply.code(200).send({
          success: true,
          data: {
            sent: true,
            ...result,
          },
          requestId,
        });
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // POST /api/v1/auth/forgot-password
  fastify.post(
    '/auth/forgot-password',
    {
      schema: {
        description: 'Request password reset instructions (always returns generic 200)',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      try {
        const body = (request.body || {}) as { email?: string };
        const result = authService.requestPasswordReset({
          email: body.email,
          ipAddress: request.ip,
          requestId,
        });

        return reply.code(200).send({
          success: true,
          data: result,
          requestId,
        });
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // POST /api/v1/auth/reset-password
  fastify.post(
    '/auth/reset-password',
    {
      schema: {
        description: 'Reset account password using a single-use token and revoke all sessions',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      try {
        const body = (request.body || {}) as {
          token?: string;
          newPassword?: string;
          password?: string;
        };

        const result = await authService.resetPassword({
          token: body.token,
          newPassword: body.newPassword ?? body.password,
          ipAddress: request.ip,
          requestId,
        });

        clearAuthCookies(reply, isSecureRequest(request));

        return reply.code(200).send({
          success: true,
          data: {
            reset: result.reset,
            sessionsRevoked: result.sessionsRevoked,
            message: 'Password updated. All active sessions have been signed out.',
          },
          requestId,
        });
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // GET /api/v1/auth/session
  fastify.get(
    '/auth/session',
    {
      schema: {
        description: 'Return current authenticated user summary or unauthenticated status',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const googleAuthConfigured = authService.isGoogleAuthConfigured();
      const auth = resolveRequestAuth(request, reply);

      if (!auth.authenticated || !auth.user || !auth.session) {
        const unauthPayload = {
          authenticated: false,
          user: null,
          csrfToken: null,
          googleAuthConfigured,
        };
        return reply.code(200).send({
          success: true,
          ...unauthPayload,
          data: unauthPayload,
          requestId,
        });
      }

      // Ensure muxaro_csrf cookie stays synced for browser clients
      const cookies = parseCookies(request.headers.cookie);
      if (cookies[CSRF_COOKIE_NAME] !== auth.session.csrfToken) {
        appendSetCookie(
          reply,
          serializeCookie(CSRF_COOKIE_NAME, auth.session.csrfToken, {
            httpOnly: false,
            secure: isSecureRequest(request),
            sameSite: 'Lax',
            path: '/',
            maxAge: 30 * 24 * 60 * 60,
          })
        );
      }

      const authPayload = {
        authenticated: true,
        googleAuthConfigured,
        csrfToken: auth.session.csrfToken,
        publicUserId: auth.user.publicUserId,
        email: auth.user.email,
        emailVerified: auth.user.emailVerified,
        displayName: auth.user.displayName,
        avatarUrl: auth.user.avatarUrl,
        role: auth.user.role,
        tier: auth.user.tier,
        mfaEnabled: auth.user.mfaEnabled,
        mfaVerified: auth.user.mfaVerified,
        user: {
          id: auth.user.id,
          internalUserId: auth.user.id,
          publicUserId: auth.user.publicUserId,
          email: auth.user.email,
          emailVerified: auth.user.emailVerified,
          displayName: auth.user.displayName,
          avatarUrl: auth.user.avatarUrl,
          role: auth.user.role,
          tier: auth.user.tier,
          mfaEnabled: auth.user.mfaEnabled,
          mfaVerified: auth.user.mfaVerified,
          createdAt: auth.user.createdAt,
        },
      };

      return reply.code(200).send({
        success: true,
        ...authPayload,
        data: authPayload,
        requestId,
      });
    }
  );

  // POST /api/v1/auth/logout
  fastify.post(
    '/auth/logout',
    {
      schema: {
        description: 'Revoke current session and clear authentication cookies',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = resolveRequestAuth(request, reply);

      if (auth.authenticated && auth.authMethod === 'cookie' && !verifyCsrf(request)) {
        return reply.code(403).send({
          success: false,
          error: {
            code: 'ERR_CSRF_INVALID',
            message: 'Invalid or missing CSRF verification token.',
            details: null,
          },
          requestId,
        });
      }

      if (auth.rawSessionToken) {
        authService.revokeSessionByToken(auth.rawSessionToken);
      }

      clearAuthCookies(reply, isSecureRequest(request));

      return reply.code(200).send({
        success: true,
        data: { loggedOut: true },
        requestId,
      });
    }
  );

  // POST /api/v1/auth/logout-all
  fastify.post(
    '/auth/logout-all',
    {
      schema: {
        description: 'Revoke all active sessions for the authenticated user',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user) return;

      const revokedCount = authService.revokeAllSessions(auth.user.id, requestId);
      clearAuthCookies(reply, isSecureRequest(request));

      return reply.code(200).send({
        success: true,
        data: {
          loggedOut: true,
          revokedCount,
          sessionsRevoked: revokedCount,
        },
        requestId,
      });
    }
  );

  // GET /api/v1/auth/google/start
  fastify.get(
    '/auth/google/start',
    {
      schema: {
        description: 'Start Google OAuth 2.0 Authorization Code + PKCE (S256) flow',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      try {
        const query = (request.query || {}) as { returnTo?: string };
        const result = authService.startGoogleOAuth({
          returnTo: query.returnTo,
          ipAddress: request.ip,
        });

        appendSetCookie(
          reply,
          serializeCookie(OAUTH_STATE_COOKIE_NAME, result.stateCookieValue, {
            httpOnly: true,
            secure: isSecureRequest(request),
            sameSite: 'Lax',
            path: '/api/v1/auth/google',
            maxAge: 600,
          })
        );

        return reply.redirect(result.authorizationUrl);
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // GET /api/v1/auth/google/callback
  fastify.get(
    '/auth/google/callback',
    {
      schema: {
        description: 'Complete Google OAuth 2.0 PKCE callback and verify Google ID token via JWKS',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const secure = isSecureRequest(request);

      // Clear single-use OAuth state binding cookie unconditionally
      appendSetCookie(
        reply,
        serializeCookie(OAUTH_STATE_COOKIE_NAME, '', {
          httpOnly: true,
          secure,
          sameSite: 'Lax',
          path: '/api/v1/auth/google',
          maxAge: 0,
          expires: new Date(0),
        })
      );

      try {
        const query = (request.query || {}) as {
          code?: string;
          state?: string;
          error?: string;
        };

        if (!authService.isGoogleAuthConfigured()) {
          return reply.code(503).send({
            success: false,
            error: {
              code: 'ERR_GOOGLE_AUTH_NOT_CONFIGURED',
              message: 'Google sign-in is not configured on this server.',
              details: null,
            },
            requestId,
          });
        }

        if (query.error) {
          return reply.redirect(`${getFrontendBaseUrl()}/login?oauthError=cancelled`);
        }

        const cookies = parseCookies(request.headers.cookie);
        const result = await authService.completeGoogleOAuth({
          code: query.code,
          state: query.state,
          cookieStateHash: cookies[OAUTH_STATE_COOKIE_NAME],
          previousSessionToken: cookies[SESSION_COOKIE_NAME] || null,
          userAgent: request.headers['user-agent'] || null,
          ipAddress: request.ip,
          requestId,
        });

        setAuthCookies(reply, result.sessionToken, result.csrfToken, secure);
        return reply.redirect(`${getFrontendBaseUrl()}${result.returnTo}`);
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // POST /api/v1/auth/mfa/setup
  fastify.post(
    '/auth/mfa/setup',
    {
      schema: {
        description: 'Generate RFC 6238 TOTP MFA secret and otpauth URI for enrollment',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user) return;

      try {
        const setup = authService.setupMfa(auth.user.id);
        return reply.code(200).send({
          success: true,
          data: setup,
          requestId,
        });
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // POST /api/v1/auth/mfa/verify
  fastify.post(
    '/auth/mfa/verify',
    {
      schema: {
        description: 'Verify a 6-digit TOTP code to enable MFA and elevate current session',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user || !auth.session) return;

      try {
        const body = (request.body || {}) as { code?: string };
        const result = authService.verifyMfa({
          userId: auth.user.id,
          sessionId: auth.session.id,
          code: String(body.code || ''),
          ipAddress: request.ip,
          requestId,
        });

        return reply.code(200).send({
          success: true,
          data: {
            verified: true,
            ...result,
          },
          requestId,
        });
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );

  // POST /api/v1/auth/mfa/disable
  fastify.post(
    '/auth/mfa/disable',
    {
      schema: {
        description: 'Disable TOTP MFA after verifying a valid current TOTP code',
        tags: ['Authentication'],
      },
    },
    async (request, reply) => {
      const requestId = (request.id as string) || `req_${Date.now()}`;
      const auth = await requireAuth(request, reply);
      if (!auth || reply.sent || !auth.user) return;

      try {
        const body = (request.body || {}) as { code?: string };
        const result = authService.disableMfa({
          userId: auth.user.id,
          code: String(body.code || ''),
          ipAddress: request.ip,
          requestId,
        });

        return reply.code(200).send({
          success: true,
          data: {
            disabled: true,
            ...result,
          },
          requestId,
        });
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    }
  );
};
