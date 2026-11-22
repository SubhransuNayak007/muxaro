/**
 * MUXARO Zero-Wait Pipelined Stream Engine - Stage 2: AIMD Controller
 * apps/web/lib/stream-engine/aimd-concurrency.ts
 *
 * Congestion-Aware AIMD Concurrency Controller:
 * - Starts concurrency at 4
 * - Scales additively (+1) up to 8 on sustained low-latency chunk downloads
 * - Multiplicatively decreases on congestion signals (429, 503, timeout, or RTT spike)
 * - Tracks Exponential Weighted Moving Average (EWMA) of Round-Trip Time
 */

import type { AIMDConfig } from './types.ts';

export const DEFAULT_AIMD_CONFIG: AIMDConfig = {
  initialConcurrency: 4,
  minConcurrency: 2,
  maxConcurrency: 8,
  additiveIncreaseThreshold: 3, // 3 consecutive fast chunks -> +1 worker
  rttSpikeRatio: 2.0, // RTT > 2x EWMA triggers backoff
};

export class AimdConcurrencyController {
  private config: AIMDConfig;
  private currentConcurrency: number;
  private consecutiveSuccesses: number = 0;
  private ewmaRttMs: number = 0;
  private alpha: number = 0.25; // EWMA weight for recent RTT

  constructor(customConfig?: Partial<AIMDConfig>) {
    this.config = { ...DEFAULT_AIMD_CONFIG, ...customConfig };
    this.currentConcurrency = Math.min(
      this.config.maxConcurrency,
      Math.max(this.config.minConcurrency, this.config.initialConcurrency)
    );
  }

  public getConcurrency(): number {
    return this.currentConcurrency;
  }

  public getEwmaRttMs(): number {
    return Math.round(this.ewmaRttMs);
  }

  /**
   * Called when a chunk fetch succeeds
   * @param durationMs Duration of chunk fetch in milliseconds
   * @param bytes Transferred byte count
   */
  public recordSuccess(durationMs: number, bytes: number): void {
    if (this.ewmaRttMs === 0) {
      this.ewmaRttMs = durationMs;
    } else {
      this.ewmaRttMs = (1 - this.alpha) * this.ewmaRttMs + this.alpha * durationMs;
    }

    // Check if latency spiked noticeably above recent average
    if (this.ewmaRttMs > 0 && durationMs > this.ewmaRttMs * this.config.rttSpikeRatio) {
      this.handleCongestion('latency_spike');
      return;
    }

    this.consecutiveSuccesses++;

    // Additive Increase: +1 worker every `additiveIncreaseThreshold` smooth chunks
    if (
      this.consecutiveSuccesses >= this.config.additiveIncreaseThreshold &&
      this.currentConcurrency < this.config.maxConcurrency
    ) {
      this.currentConcurrency++;
      this.consecutiveSuccesses = 0;
    }
  }

  /**
   * Called on network congestion, rate limit (HTTP 429), server throttle (503), or timeout
   */
  public recordCongestion(reason: 'http_429' | 'http_503' | 'timeout' | 'network_error'): void {
    this.handleCongestion(reason);
  }

  private handleCongestion(reason: string): void {
    this.consecutiveSuccesses = 0;
    // Multiplicative decrease: reduce to 75% or halve, down to minimum bound
    const decreased = Math.max(
      this.config.minConcurrency,
      Math.floor(this.currentConcurrency * 0.75)
    );
    this.currentConcurrency = decreased;
  }

  public reset(): void {
    this.currentConcurrency = this.config.initialConcurrency;
    this.consecutiveSuccesses = 0;
    this.ewmaRttMs = 0;
  }
}
