/**
 * MUXARO Zero-Wait Pipelined Stream Engine - Stage 2: Dynamic Chunk Sizer
 * apps/web/lib/stream-engine/chunk-sizer.ts
 *
 * Dynamic Range Chunk Sizing:
 * - Adapts chunk size between 512KB and 8MB based on real-time bandwidth & RTT
 * - Targets ~500ms transfer time per chunk to optimize TCP window throughput
 * - Granular 512KB alignment for clean memory block allocations
 */

import type { ChunkSizerConfig } from './types.ts';

export const DEFAULT_CHUNK_SIZER_CONFIG: ChunkSizerConfig = {
  minChunkSize: 512 * 1024, // 512 KB
  maxChunkSize: 8 * 1024 * 1024, // 8 MB
  defaultChunkSize: 1024 * 1024, // 1 MB
  targetChunkDurationMs: 500, // 500ms target transfer duration
};

export class DynamicChunkSizer {
  private config: ChunkSizerConfig;
  private currentChunkSize: number;
  private ewmaSpeedBytesPerSec: number = 0;
  private alpha: number = 0.3; // Speed smoothing factor

  constructor(customConfig?: Partial<ChunkSizerConfig>) {
    this.config = { ...DEFAULT_CHUNK_SIZER_CONFIG, ...customConfig };
    this.currentChunkSize = this.config.defaultChunkSize;
  }

  public getChunkSize(): number {
    return this.currentChunkSize;
  }

  public getThroughputBytesPerSec(): number {
    return Math.round(this.ewmaSpeedBytesPerSec);
  }

  /**
   * Updates throughput estimate from a completed chunk
   * @param bytesTransferred Byte size of chunk
   * @param durationMs Transfer duration in ms
   */
  public recordChunkTransfer(bytesTransferred: number, durationMs: number): void {
    if (durationMs <= 0 || bytesTransferred <= 0) return;

    const instantaneousSpeed = (bytesTransferred / durationMs) * 1000;

    if (this.ewmaSpeedBytesPerSec === 0) {
      this.ewmaSpeedBytesPerSec = instantaneousSpeed;
    } else {
      this.ewmaSpeedBytesPerSec =
        (1 - this.alpha) * this.ewmaSpeedBytesPerSec + this.alpha * instantaneousSpeed;
    }

    // Target chunk bytes = throughput * target duration (e.g. 500ms)
    const targetBytes = this.ewmaSpeedBytesPerSec * (this.config.targetChunkDurationMs / 1000);

    // Round to nearest 512KB step
    const step = 512 * 1024;
    const rounded = Math.round(targetBytes / step) * step;

    // Clamp strictly within [minChunkSize, maxChunkSize]
    this.currentChunkSize = Math.max(
      this.config.minChunkSize,
      Math.min(this.config.maxChunkSize, rounded || this.config.minChunkSize)
    );
  }

  public reset(): void {
    this.currentChunkSize = this.config.defaultChunkSize;
    this.ewmaSpeedBytesPerSec = 0;
  }
}
