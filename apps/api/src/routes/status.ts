/**
 * MUXARO Media Processing Platform - System Telemetry & Status Routes
 *
 * Implements GET /v1/status:
 * Aggregates:
 * 1. PostgreSQL connection health and ping latency
 * 2. Redis cluster/instance health and ping latency
 * 3. Real-time BullMQ queue depths across all lanes (lane:analyse, lane:fast-io, lane:transcode, lane:batch)
 * 4. Active worker heartbeats (muxaro:heartbeat:{type}:{workerId})
 * 5. Upstream circuit breaker states (youtube, vimeo, r2, database)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDb, getMuxaroRedis, sql } from '@muxaro/db';
import type {
  ServiceStatusResponse,
  CircuitState,
  WorkerTelemetry,
} from '@muxaro/shared';
import { getQueueDepths } from '../lib/queues.js';

export const statusRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const redis = getMuxaroRedis();

  fastify.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    // 1. PostgreSQL Health Check
    let postgresConnected = false;
    let postgresLatencyMs = 0;
    try {
      const start = Date.now();
      await Promise.race([
        db.execute(sql`SELECT 1`),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 500)),
      ]);
      postgresLatencyMs = Math.max(0, Date.now() - start);
      postgresConnected = true;
    } catch {
      postgresConnected = false;
      postgresLatencyMs = 0;
    }

    // 2. Redis Health Check
    let redisConnected = false;
    let redisLatencyMs = 0;
    try {
      const start = Date.now();
      await Promise.race([
        redis.raw.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis Timeout')), 500)),
      ]);
      redisLatencyMs = Math.max(0, Date.now() - start);
      redisConnected = true;
    } catch {
      redisConnected = false;
      redisLatencyMs = 0;
    }

    // 3. BullMQ Lane Queue Depths
    const queues = await getQueueDepths();

    // 4. Redis Worker Heartbeats
    const workerRecords: Record<string, WorkerTelemetry> = {};
    if (redisConnected) {
      try {
        const activeWorkers = await Promise.race([
          redis.getActiveWorkers(),
          new Promise<WorkerTelemetry[]>((_, reject) =>
            setTimeout(() => reject(new Error('Heartbeat scan timeout')), 500)
          ),
        ]);
        for (const w of activeWorkers) {
          if (w && w.workerId) {
            workerRecords[w.workerId] = w;
          }
        }
      } catch {
        // In case Redis scan fails
      }
    }

    // 5. Circuit Breaker States
    const targetServices = ['youtube', 'vimeo', 'r2', 'database'];
    const circuitBreakers: Record<
      string,
      { state: CircuitState; failureCount: number; lastFailureTime?: string; nextRetryTime?: string }
    > = {};

    let hasOpenCircuit = false;
    for (const s of targetServices) {
      let state: CircuitState = 'CLOSED';
      if (redisConnected) {
        try {
          state = (await Promise.race([
            redis.getCircuitState(s),
            new Promise<CircuitState>((_, reject) =>
              setTimeout(() => reject(new Error('Circuit check timeout')), 300)
            ),
          ])) as CircuitState;
        } catch {
          state = 'CLOSED';
        }
      }
      if (state === 'OPEN') {
        hasOpenCircuit = true;
      }
      circuitBreakers[s] = {
        state,
        failureCount: state === 'OPEN' ? 5 : 0,
      };
    }

    // 6. Overall Status Determination
    let status: 'healthy' | 'degraded' | 'outage' = 'healthy';
    if (!postgresConnected || !redisConnected) {
      status = 'outage';
    } else if (
      hasOpenCircuit ||
      (queues['lane:transcode']?.waiting ?? 0) > 100 ||
      (queues['lane:fast-io']?.waiting ?? 0) > 200
    ) {
      status = 'degraded';
    }

    const responseData: ServiceStatusResponse = {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      postgres: {
        connected: postgresConnected,
        latencyMs: postgresLatencyMs,
      },
      redis: {
        connected: redisConnected,
        latencyMs: redisLatencyMs,
      },
      queues,
      workers: workerRecords,
      circuitBreakers,
      timestamp: new Date().toISOString(),
    };

    return reply.status(200).send({
      success: true,
      data: responseData,
      ...responseData,
    });
  });
};
