/**
 * Project MUXARO - Fastify Application Factory
 * Production-ready API server integrating CORS (credentials + CSRF), multi-layer rate limiting,
 * structured redacted telemetry, Swagger, error handling, and all Account Platform + Media routes.
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import crypto from 'node:crypto';
import { config } from './config.js';
import { getDb } from './db/database.js';
import { resolveRequestAuth } from './middleware/auth.middleware.js';
import {
  extractClientIp,
  hashBucketDimension,
  rateLimitService,
  redactSensitiveData,
  type RateLimitPolicyName,
} from './services/ratelimit.service.js';
import { adminService } from './services/admin.service.js';

// Route imports
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { entitlementRoutes } from './routes/entitlements.js';
import { rewardRoutes } from './routes/rewards.js';
import { batchRoutes } from './routes/batches.js';
import { mediaRoutes } from './routes/media.js';
import { jobRoutes } from './routes/jobs.js';
import { toolsRoutes } from './routes/tools.js';
import { playlistRoutes } from './routes/playlists.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { downloadRoutes } from './routes/download.js';
import { downloadsRoutes } from './routes/downloads.js';
import { probeRoutes } from './routes/probe.js';
import { aiRoutes } from './routes/ai.js';

function resolveCorsOriginConfig(): boolean | string | string[] {
  const raw = config.corsOrigin;
  if (raw === true || raw === '*') {
    // Reflect exact request Origin header so browser cookies (`credentials: 'include'`) work seamlessly
    return true;
  }
  if (Array.isArray(raw)) {
    const cleaned = raw.map((o) => o.trim()).filter(Boolean);
    if (cleaned.length === 0 || cleaned.includes('*')) {
      return true;
    }
    return cleaned;
  }
  return raw;
}

function matchRateLimitPolicy(method: string, pathWithoutQuery: string): RateLimitPolicyName | null {
  if (method !== 'POST') return null;

  if (pathWithoutQuery === '/api/v1/media/inspect') {
    return 'media_inspect';
  }
  if (
    pathWithoutQuery === '/api/v1/jobs' ||
    pathWithoutQuery === '/api/v1/batches' ||
    pathWithoutQuery === '/api/v1/tools/merge' ||
    pathWithoutQuery === '/api/v1/playlists/process'
  ) {
    return 'job_create';
  }
  if (
    pathWithoutQuery === '/api/v1/media/upload' ||
    pathWithoutQuery === '/api/v1/media/upload/init'
  ) {
    return 'upload_init';
  }
  if (
    /^\/api\/v1\/jobs\/[^/]+\/cancel$/.test(pathWithoutQuery) ||
    /^\/api\/v1\/batches\/[^/]+\/cancel$/.test(pathWithoutQuery)
  ) {
    return 'job_cancel';
  }
  if (pathWithoutQuery === '/api/v1/rewards/sessions') {
    return 'reward_claim';
  }
  if (pathWithoutQuery === '/api/v1/auth/register') {
    return 'register_ip';
  }
  if (
    pathWithoutQuery === '/api/v1/auth/forgot-password' ||
    pathWithoutQuery === '/api/v1/auth/reset-password' ||
    pathWithoutQuery === '/api/v1/auth/verify-email' ||
    pathWithoutQuery === '/api/v1/auth/resend-verification'
  ) {
    return 'auth_recovery';
  }

  return null;
}

export async function buildApp(): Promise<FastifyInstance> {
  // Ensure persistent relational SQLite DB & optional env-based admin bootstrap are initialized
  getDb();
  adminService.syncBootstrapAdminFromEnv();

  const app = Fastify({
    logger: false,
    routerOptions: {
      maxParamLength: 1024,
    },
    genReqId: () => `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    bodyLimit: config.maxPayloadBytes,
  });

  // 1. CORS plugin (credentials: true + exact origin reflection + x-muxaro-csrf)
  await app.register(cors, {
    origin: resolveCorsOriginConfig(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'x-request-id',
      'x-file-name',
      'x-muxaro-csrf',
      'x-muxaro-byok',
      'x-muxaro-tavily-key',
      'x-muxaro-brave-key',
      'x-muxaro-mcp-auth',
    ],
    exposedHeaders: [
      'x-request-id',
      'Retry-After',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Content-Disposition',
      'Content-Range',
      'Accept-Ranges',
      'ETag',
    ],
    credentials: true,
  });

  // 2. Fastify Sensible for standard HTTP errors
  await app.register(sensible);

  // 3. OpenAPI Documentation with Swagger & Swagger UI
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'MUXARO Media Processing & Account Platform API',
        description:
          'High-performance REST & SSE media processing API with cookie-based authentication, Google OAuth 2.0 + PKCE, TOTP Admin MFA, rolling quotas, Google Ad Manager SSV rewarded credits, multi-layer rate limiting, and strict IDOR/SSRF protection.',
        version: '2.0.0',
      },
      servers: [
        {
          url: `http://localhost:${config.port}/api/v1`,
          description: 'Local development server',
        },
      ],
      tags: [
        { name: 'System', description: 'System health and readiness' },
        { name: 'Authentication', description: 'Email auth, Google OAuth 2.0 PKCE, sessions, and TOTP MFA' },
        { name: 'User Profile & Sessions', description: 'Authenticated user profile, identity, and device sessions' },
        { name: 'Entitlements & Credits', description: 'Rolling 24h allowances and immutable credit ledger' },
        { name: 'Rewarded Ads', description: 'Google Ad Manager SSV rewarded credit sessions' },
        { name: 'Batch Processing', description: 'Batch job creation, item tracking, and cancellation' },
        { name: 'Media Inspection', description: 'Inspection of external media streams and local uploads' },
        { name: 'Job Execution', description: 'Asynchronous job submission and SSE progress stream' },
        { name: 'Media Tools', description: 'Audio/Video merging and conversion tools' },
        { name: 'Playlist Processing', description: 'Batch playlist inspection and processing' },
        { name: 'Account & Quota', description: 'Transparent rolling quota allowances and job history' },
        { name: 'Download Delivery', description: 'Secure signed download token delivery with HTTP Range' },
        { name: 'Administration & SRE', description: 'MFA-protected Admin Control Centre and operational telemetry' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // 4. Multi-Layer Rate Limiting & Duplicate Flood Guard (separate from daily quotas; polling exempt)
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (process.env.RATE_LIMIT_ENABLED === 'false' || process.env.NODE_ENV === 'test') {
      return;
    }

    const method = (request.method || 'GET').toUpperCase();
    const pathWithoutQuery = (request.url || '/').split('?')[0];

    // Job/batch polling, SSE streams, health, and downloads are NEVER tightly throttled
    if (rateLimitService.isExemptPollingRoute(method, pathWithoutQuery)) {
      return;
    }

    const clientIp = extractClientIp(request);
    const auth = resolveRequestAuth(request);
    const actorKey = auth.authenticated && auth.user
      ? `usr:${auth.user.id}`
      : rateLimitService.resolveRequestActorKey(request, clientIp);

    const policy = matchRateLimitPolicy(method, pathWithoutQuery);
    if (policy) {
      let evaluation;
      if (policy === 'reward_claim') {
        // Active reward claim check applies only to authenticated users (unauthenticated gets 401 in route)
        if (!auth.authenticated || !auth.user) {
          return;
        }
        evaluation = rateLimitService.checkActiveRewardClaim(auth.user.id, {
          publicUserId: auth.user.publicUserId,
          ip: clientIp,
          requestId: request.id as string,
        });
      } else {
        const dimensionKey =
          policy === 'register_ip' || policy === 'auth_recovery' ? clientIp : actorKey;
        evaluation = rateLimitService.checkPolicy(policy, dimensionKey, {
          userId: auth.user?.id ?? null,
          publicUserId: auth.user?.publicUserId ?? null,
          ip: clientIp,
          endpoint: `${method} ${pathWithoutQuery}`,
          requestId: request.id as string,
        });
      }

      rateLimitService.applyHeaders(reply, evaluation);
      if (!evaluation.allowed) {
        return rateLimitService.sendRateLimitExceeded(request, reply, evaluation);
      }
    }

    // Duplicate mutation flood detection (skip binary part uploads, login, and GAM SSV callbacks)
    if (
      (method === 'POST' || method === 'PATCH' || method === 'DELETE') &&
      pathWithoutQuery !== '/api/v1/auth/login' &&
      pathWithoutQuery !== '/api/v1/rewards/provider-callback' &&
      !pathWithoutQuery.startsWith('/api/v1/media/upload') &&
      request.body &&
      typeof request.body === 'object' &&
      !Buffer.isBuffer(request.body)
    ) {
      let fingerprint = '';
      try {
        fingerprint = hashBucketDimension(JSON.stringify(request.body));
      } catch {
        fingerprint = 'non_serializable';
      }
      const flood = rateLimitService.checkDuplicateFlood(actorKey, `${method} ${pathWithoutQuery}`, fingerprint, {
        userId: auth.user?.id ?? null,
        ip: clientIp,
        requestId: request.id as string,
      });
      if (flood.flooded) {
        reply.header('Retry-After', String(flood.retryAfterSeconds));
        return reply.code(429).send({
          success: false,
          error: {
            code: 'ERR_RATE_LIMIT_EXCEEDED',
            message: 'Too many identical requests. Please wait a moment and try again.',
            userMessage: 'Too many requests right now. Please wait a moment and try again.',
            details: { retryAfterSeconds: flood.retryAfterSeconds },
          },
          requestId: (request.id as string) || `req_${Date.now()}`,
        });
      }
    }
  });

  // 5. Request tracing & defensive security headers hook
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('x-request-id', request.id);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    if (!(request.url || '').startsWith('/docs')) {
      reply.header('X-Frame-Options', 'DENY');
    }
  });

  // 6. Structured redacted telemetry hook for server errors & security-relevant responses
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const status = reply.statusCode;
    if (status >= 500 && config.env !== 'test') {
      const safeLog = redactSensitiveData({
        level: 'error',
        event: 'http_server_error',
        requestId: request.id,
        method: request.method,
        path: (request.url || '/').split('?')[0],
        statusCode: status,
      });
      console.error(JSON.stringify(safeLog));
    }
  });

  // 7. Centralized Error Handler strictly enforcing standard envelope & zero secret leakage
  app.setErrorHandler((error: any, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.id as string) || `req_${Date.now()}`;
    const statusCode = error.statusCode || error.status || 500;

    if (statusCode === 429 && typeof error.retryAfterSeconds === 'number' && error.retryAfterSeconds > 0) {
      reply.header('Retry-After', String(Math.ceil(error.retryAfterSeconds)));
    }

    const code =
      error.code ||
      (statusCode === 404
        ? 'ERR_NOT_FOUND'
        : statusCode === 400
        ? 'ERR_BAD_REQUEST'
        : statusCode === 401
        ? 'ERR_UNAUTHORIZED'
        : statusCode === 403
        ? 'ERR_FORBIDDEN'
        : statusCode === 409
        ? 'ERR_CONFLICT'
        : statusCode === 429
        ? 'ERR_RATE_LIMIT_EXCEEDED'
        : 'ERR_INTERNAL_SERVER');

    const safeMessage =
      statusCode >= 500
        ? 'An unexpected internal error occurred'
        : String(error.message || 'Request could not be processed');

    const safeDetails =
      statusCode >= 500
        ? null
        : error.details
        ? (redactSensitiveData(error.details) as Record<string, unknown>)
        : null;

    return reply.code(statusCode).send({
      success: false,
      error: {
        code,
        message: safeMessage,
        details: safeDetails,
      },
      requestId,
    });
  });

  // 8. Register All API Routes under /api/v1
  await app.register(
    async (v1) => {
      await v1.register(healthRoutes);
      await v1.register(authRoutes);
      await v1.register(meRoutes);
      await v1.register(entitlementRoutes);
      await v1.register(rewardRoutes);
      await v1.register(batchRoutes);
      await v1.register(mediaRoutes);
      await v1.register(jobRoutes);
      await v1.register(toolsRoutes);
      await v1.register(playlistRoutes);
      await v1.register(accountRoutes);
      await v1.register(adminRoutes);
      await v1.register(downloadRoutes);
      await v1.register(downloadsRoutes);
      await v1.register(probeRoutes);
      await v1.register(aiRoutes);
    },
    { prefix: '/api/v1' }
  );

  // Direct /v1 prefix for modern worker downloads, jobs, and probe
  await app.register(downloadsRoutes, { prefix: '/v1' });
  await app.register(probeRoutes, { prefix: '/v1' });
  await app.register(jobRoutes, { prefix: '/v1' });

  // Root landing / health pointer
  app.get('/', async (_req, reply) => {
    return reply.redirect('/docs');
  });

  return app;
}
