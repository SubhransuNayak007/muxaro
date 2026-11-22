/**
 * MUXARO Media Processing Platform - Analysis Worker Heartbeat Reporter
 * 
 * Periodically reports worker telemetry (CPU, memory, active jobs, completed/failed stats)
 * to Redis key `muxaro:heartbeat:analyse:{workerId}` with EX 30 TTL.
 */

import * as os from 'node:os';
import * as process from 'node:process';
import type { Redis } from 'ioredis';
import type { WorkerTelemetry } from '@muxaro/shared';
import { REDIS_KEYS, DEFAULT_TTLS } from '@muxaro/db';

export interface HeartbeatOptions {
  workerId?: string;
  intervalMs?: number;
  ttlSeconds?: number;
  getActiveJobs: () => number;
  getStats?: () => { totalCompleted: number; totalFailed: number };
}

export class HeartbeatReporter {
  public readonly workerId: string;
  private readonly redis: Redis;
  private readonly intervalMs: number;
  private readonly ttlSeconds: number;
  private readonly getActiveJobs: () => number;
  private readonly getStats?: () => { totalCompleted: number; totalFailed: number };

  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastCpuTimestamp: number = 0;

  constructor(redis: Redis, options: HeartbeatOptions) {
    this.redis = redis;
    this.workerId = options.workerId || `analyse-${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.intervalMs = options.intervalMs ?? 10_000;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTLS.workerHeartbeatSeconds;
    this.getActiveJobs = options.getActiveJobs;
    this.getStats = options.getStats;
  }

  /**
   * Starts periodic heartbeat emission
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTimestamp = Date.now();

    // Send immediate initial heartbeat
    void this.emitHeartbeat();

    this.timer = setInterval(() => {
      void this.emitHeartbeat();
    }, this.intervalMs);

    // Unref timer so it doesn't prevent process exit
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops periodic heartbeat emission and removes heartbeat key
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    try {
      const key = REDIS_KEYS.workerHeartbeat('analyse', this.workerId);
      await this.redis.del(key);
    } catch {
      // Ignore cleanup error on shutdown
    }
  }

  /**
   * Emits a single heartbeat to Redis
   */
  public async emitHeartbeat(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const now = Date.now();
      let cpuUsagePercent = 0;

      if (this.lastCpuUsage && this.lastCpuTimestamp > 0) {
        const elapsedMs = Math.max(1, now - this.lastCpuTimestamp);
        const cpuDiff = process.cpuUsage(this.lastCpuUsage);
        const totalCpuMicros = cpuDiff.user + cpuDiff.system;
        const totalCpuMs = totalCpuMicros / 1000;
        const cpus = os.cpus().length || 1;
        // Percentage of total capacity across all cores
        cpuUsagePercent = Math.min(100, Math.max(0, Number(((totalCpuMs / (elapsedMs * cpus)) * 100).toFixed(2))));
      }

      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuTimestamp = now;

      const memUsage = process.memoryUsage();
      const memoryUsageMb = Number((memUsage.heapUsed / (1024 * 1024)).toFixed(2));

      const stats = this.getStats ? this.getStats() : { totalCompleted: 0, totalFailed: 0 };
      const activeJobs = this.getActiveJobs();

      const telemetry: WorkerTelemetry = {
        workerId: this.workerId,
        workerType: 'analyse',
        host: os.hostname(),
        pid: process.pid,
        activeJobs,
        totalCompleted: stats.totalCompleted,
        totalFailed: stats.totalFailed,
        cpuUsagePercent,
        memoryUsageMb,
        lastHeartbeat: new Date(now).toISOString(),
      };

      const key = REDIS_KEYS.workerHeartbeat('analyse', this.workerId);
      await this.redis.set(key, JSON.stringify(telemetry), 'EX', this.ttlSeconds);
    } catch (err) {
      console.error(`[HeartbeatReporter] Failed to emit heartbeat for ${this.workerId}:`, err);
    }
  }
}
