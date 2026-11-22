/**
 * MUXARO Media Processing Platform - Media Worker Telemetry & Heartbeat
 * 
 * Reports live worker health, resource utilization (CPU, RAM), and active lane
 * capacity to Redis key `muxaro:heartbeat:media:{workerId}` with EX 30 TTL.
 */

import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { WorkerTelemetry } from '@muxaro/shared';
import { getMuxaroRedis, type MuxaroRedisClient } from '@muxaro/db';

export interface HeartbeatOptions {
  readonly workerId?: string;
  readonly intervalMs?: number;
  readonly redisClient?: MuxaroRedisClient;
}

export class MediaWorkerHeartbeat {
  private readonly workerId: string;
  private readonly intervalMs: number;
  private readonly redis: MuxaroRedisClient;
  private intervalTimer: NodeJS.Timeout | null = null;

  // Telemetry metrics counters
  private activeJobsCount = 0;
  private totalCompletedCount = 0;
  private totalFailedCount = 0;
  private laneActiveCounts: Record<string, number> = {
    'lane:fast-io': 0,
    'lane:transcode': 0,
    'lane:batch': 0,
    'cleanup': 0,
  };

  // CPU measurement reference
  private previousCpuUsage = process.cpuUsage();
  private previousCpuTime = Date.now();

  constructor(options: HeartbeatOptions = {}) {
    this.workerId = options.workerId || process.env.WORKER_ID || `worker-media-${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.intervalMs = options.intervalMs || 10_000; // 10 seconds heartbeat
    this.redis = options.redisClient || getMuxaroRedis();
  }

  public get id(): string {
    return this.workerId;
  }

  // ===========================================================================
  // METRICS COUNTERS
  // ===========================================================================

  public incrementActive(lane: string): void {
    this.activeJobsCount++;
    this.laneActiveCounts[lane] = (this.laneActiveCounts[lane] || 0) + 1;
  }

  public decrementActive(lane: string): void {
    this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
    if (this.laneActiveCounts[lane]) {
      this.laneActiveCounts[lane] = Math.max(0, this.laneActiveCounts[lane] - 1);
    }
  }

  public recordCompleted(): void {
    this.totalCompletedCount++;
  }

  public recordFailed(): void {
    this.totalFailedCount++;
  }

  // ===========================================================================
  // TELEMETRY EMISSION
  // ===========================================================================

  /**
   * Captures current process metrics and emits telemetry to Redis with EX 30
   */
  public async sendHeartbeat(): Promise<void> {
    const mem = process.memoryUsage();
    const memoryUsageMb = Math.round(mem.rss / (1024 * 1024));

    // Calculate CPU usage percentage across elapsed time
    const currentCpu = process.cpuUsage();
    const now = Date.now();
    const timeDeltaMs = (now - this.previousCpuTime) * 1000; // microseconds
    const userDelta = currentCpu.user - this.previousCpuUsage.user;
    const sysDelta = currentCpu.system - this.previousCpuUsage.system;

    let cpuUsagePercent = 0;
    if (timeDeltaMs > 0) {
      const cpus = os.cpus().length || 1;
      cpuUsagePercent = Math.min(
        100,
        Math.round(((userDelta + sysDelta) / (timeDeltaMs * cpus)) * 1000) / 10
      );
    }

    this.previousCpuUsage = currentCpu;
    this.previousCpuTime = now;

    const telemetry: WorkerTelemetry & { lanes: Record<string, number> } = {
      workerId: this.workerId,
      workerType: 'media',
      host: os.hostname(),
      pid: process.pid,
      activeJobs: this.activeJobsCount,
      totalCompleted: this.totalCompletedCount,
      totalFailed: this.totalFailedCount,
      cpuUsagePercent,
      memoryUsageMb,
      lastHeartbeat: new Date().toISOString(),
      lanes: { ...this.laneActiveCounts },
    };

    try {
      await this.redis.sendWorkerHeartbeat('media', this.workerId, telemetry, 30);
    } catch (err: any) {
      console.warn(`[Heartbeat] Failed to emit telemetry to Redis: ${err.message}`);
    }
  }

  /**
   * Starts periodic heartbeat timer
   */
  public start(): void {
    if (this.intervalTimer) return;

    // Send immediate first heartbeat
    this.sendHeartbeat().catch(() => {});

    this.intervalTimer = setInterval(() => {
      this.sendHeartbeat().catch(() => {});
    }, this.intervalMs);
  }

  /**
   * Stops heartbeat timer and clears heartbeat key from Redis on graceful shutdown
   */
  public async stop(): Promise<void> {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    try {
      const raw = this.redis.raw;
      const key = `muxaro:heartbeat:media:${this.workerId}`;
      await raw.del(key);
    } catch {
      // ignore
    }
  }
}

let globalHeartbeat: MediaWorkerHeartbeat | null = null;

export function getWorkerHeartbeat(): MediaWorkerHeartbeat {
  if (!globalHeartbeat) {
    globalHeartbeat = new MediaWorkerHeartbeat();
  }
  return globalHeartbeat;
}
