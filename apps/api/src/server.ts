/**
 * MUXARO Media Processing Platform - Production Fastify 5 API Gateway
 *
 * Implements:
 * 1. Fastify 5 server initialization with Pino logging & redaction
 * 2. Cross-Origin Resource Sharing (CORS) with credentials & dynamic origins
 * 3. Security headers via Helmet (HSTS, frameguard, CORP)
 * 4. Authentication, Quota, and Redis ZSET Sliding-Window Rate Limiting plugins
 * 5. Complete /v1 and /api/v1 route registration (analyse, uploads, jobs, downloads, status, usage)
 * 6. Standardized error envelope and Zod / MuxaroError serialization
 * 7. Graceful zero-downtime shutdown on SIGTERM / SIGINT
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { MuxaroError } from '@muxaro/shared';
import { closeDb, getDb, getMuxaroRedis } from '@muxaro/db';

import { authPlugin } from './plugins/auth.js';
import { rateLimiterPlugin } from './plugins/rate-limiter.js';
import { analyseRoutes } from './routes/analyse.js';
import { uploadsRoutes } from './routes/uploads.js';
import { jobsRoutes } from './routes/jobs.js';
import { downloadsRoutes } from './routes/downloads.js';
import { statusRoutes } from './routes/status.js';
import { usageRoutes } from './routes/usage.js';
import { authRoutes } from './routes/auth.js';
import { accountRoutes } from './routes/account.js';
import { healthRoutes } from './routes/health.js';
import { probeRoutes } from './routes/probe.js';
import { closeQueues } from './lib/queues.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  logLevel?: string;
  enableSwagger?: boolean;
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const isProd = process.env.NODE_ENV === 'production';
  const logLevel = options.logLevel || process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

  const fastify = Fastify({
    logger: {
      level: logLevel,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-guest-id"]',
        'req.headers["x-csrf-token"]',
        'password',
        'token',
        'poToken',
        'secret',
      ],
    },
    trustProxy: true,
    requestIdHeader: 'x-request-id',
  });

  // 1. CORS Configuration
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://muxaro.pages.dev', 'https://muxaro.vercel.app'];

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) {
        cb(null, true);
        return;
      }
      if (
        corsOrigins.includes('*') ||
        corsOrigins.includes(origin) ||
        origin.endsWith('.muxaro.pages.dev') ||
        origin.endsWith('.muxaro.app') ||
        origin.endsWith('.vercel.app')
      ) {
        cb(null, true);
        return;
      }
      // Strict origin defense: disallow untrusted third-party origins
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Idempotency-Key',
      'X-User-Id',
      'X-Guest-Id',
      'Range',
      'x-muxaro-csrf',
      'X-CSRF-Token',
    ],
    exposedHeaders: [
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
      'Content-Range',
      'Content-Length',
      'Accept-Ranges',
      'ETag',
      'Content-Disposition',
    ],
  });

  // 2. Helmet Security Headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // Pure API gateway with SSE
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: isProd
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  });

  // 3. Fastify Sensible Utilities
  await fastify.register(sensible);

  // 4. Custom Application Plugins
  await fastify.register(authPlugin);
  await fastify.register(rateLimiterPlugin);

  // 5. Global Standardized Error Handler (Registered before routes for encapsulation inheritance)
  fastify.setErrorHandler((error: Error | MuxaroError | ZodError, request, reply) => {
    request.log.error(
      {
        err: error,
        url: request.url,
        method: request.method,
        reqId: request.id,
      },
      '[API ErrorHandler] Exception captured'
    );

    // MuxaroError
    const isMuxaroError =
      error instanceof MuxaroError ||
      (error && (error as any).name === 'MuxaroError') ||
      (error && typeof (error as any).statusCode === 'number' && (error as any).code);

    if (isMuxaroError) {
      const err = error as any;
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message,
          statusCode: err.statusCode || 500,
          details: err.details,
          timestamp: err.timestamp || new Date().toISOString(),
        },
        requestId: request.id,
      });
    }

    // Zod Validation Error
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Request payload validation failed',
          statusCode: 400,
          details: error.format(),
          timestamp: new Date().toISOString(),
        },
        requestId: request.id,
      });
    }

    // Fastify Schema Validation Error
    const fastifyErr = error as any;
    if (fastifyErr.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: fastifyErr.message || 'Validation failed',
          statusCode: 400,
          details: fastifyErr.validation,
          timestamp: new Date().toISOString(),
        },
        requestId: request.id,
      });
    }

    // Generic Internal Error
    const statusCode = typeof fastifyErr.statusCode === 'number' ? fastifyErr.statusCode : 500;
    const isSafe = statusCode < 500;

    return reply.status(statusCode).send({
      success: false,
      error: {
        code: fastifyErr.code || 'INTERNAL_ERROR',
        message: isSafe || !isProd ? error.message : 'An unexpected internal error occurred.',
        statusCode,
        details: !isProd ? fastifyErr.stack : null,
        timestamp: new Date().toISOString(),
      },
      requestId: request.id,
    });
  });

  // 6. Global 404 Handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
        statusCode: 404,
        timestamp: new Date().toISOString(),
      },
      requestId: request.id,
    });
  });

  // 7. Root Health Probes
  const healthHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      status: 'healthy',
      service: 'muxaro-api',
      version: '1.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  };

  fastify.get('/health', healthHandler);
  fastify.get('/_health', healthHandler);

  // 8. Register API Route Modules (/v1 and /api/v1 aliases)
  const routeModules = [
    healthRoutes,
    probeRoutes,
    analyseRoutes,
    uploadsRoutes,
    jobsRoutes,
    downloadsRoutes,
    statusRoutes,
    usageRoutes,
    authRoutes,
    accountRoutes,
  ];

  for (const mod of routeModules) {
    await fastify.register(mod, { prefix: '/v1' });
    await fastify.register(mod, { prefix: '/api/v1' });
  }

  return fastify;
}

let isShuttingDown = false;

export async function startServer(): Promise<void> {
  const port = Number.parseInt(process.env.PORT || '4000', 10);
  const host = process.env.HOST || '0.0.0.0';

  const server = await buildServer({ port, host });

  try {
    const address = await server.listen({ port, host });
    server.log.info(`[MUXARO API] Server actively listening at ${address}`);
    server.log.info(`[MUXARO API] Health check endpoint at ${address}/health`);
    server.log.info(`[MUXARO API] System telemetry status at ${address}/v1/status`);
  } catch (err) {
    server.log.fatal({ err }, '[MUXARO API] Failed to bind server socket');
    process.exit(1);
  }

  // Graceful Shutdown Registration
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    server.log.info(`[MUXARO API] Received ${signal}. Initiating graceful shutdown...`);

    try {
      // 1. Stop accepting new HTTP requests
      await server.close();
      server.log.info('[MUXARO API] Fastify server closed.');

      // 2. Close BullMQ queue instances
      await closeQueues();
      server.log.info('[MUXARO API] BullMQ queues disconnected.');

      // 3. Disconnect Redis client
      const redis = getMuxaroRedis();
      await redis.quit();
      server.log.info('[MUXARO API] Redis connection closed.');

      // 4. Terminate PostgreSQL connection pool
      await closeDb();
      server.log.info('[MUXARO API] PostgreSQL database pool closed.');

      server.log.info('[MUXARO API] Graceful shutdown complete. Exiting.');
      process.exit(0);
    } catch (err) {
      server.log.error({ err }, '[MUXARO API] Error encountered during shutdown sequence');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Auto-start when executed directly
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFilePath.endsWith(process.argv[1])) {
  startServer().catch((err) => {
    console.error('[MUXARO API] Fatal initialization error:', err);
    process.exit(1);
  });
}
