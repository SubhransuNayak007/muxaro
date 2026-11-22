/**
 * MUXARO Zero-Wait Pipelined Stream Engine - Stage 2: Parallel Range Pipeline
 * apps/web/lib/stream-engine/range-pipeline.ts
 *
 * Parallel Range Pipeline Orchestrator:
 * - Coordinates parallel chunk downloads with dynamic chunk sizing (512KB - 8MB)
 * - Governed by AIMD Concurrency Controller (starts at 4, scales to 8)
 * - Feeds into OrderedSlidingRingBuffer with backpressure throttling at 32MB
 */

import { AimdConcurrencyController } from './aimd-concurrency.ts';
import { DynamicChunkSizer } from './chunk-sizer.ts';
import { OrderedSlidingRingBuffer } from './ring-buffer.ts';
import type { BufferChunk } from './ring-buffer.ts';
import type { StreamProgress, StreamStage } from './types.ts';

export interface RangePipelineOptions {
  url: string;
  totalBytes?: number;
  initialChunkSize?: number;
  initialConcurrency?: number;
  maxBufferBytes?: number;
  streamType?: 'video' | 'audio' | 'unified';
  signal?: AbortSignal;
  onProgress?: (progress: Partial<StreamProgress>) => void;
  onChunkReceived?: (chunk: BufferChunk) => void;
}

export class ParallelRangePipeline {
  private url: string;
  private totalBytes: number;
  private streamType: 'video' | 'audio' | 'unified';
  private signal?: AbortSignal;

  private aimd: AimdConcurrencyController;
  private chunkSizer: DynamicChunkSizer;
  private ringBuffer: OrderedSlidingRingBuffer;

  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private pausePromiseResolve: (() => void) | null = null;

  private nextByteOffset: number = 0;
  private nextChunkIndex: number = 0;
  private downloadedBytes: number = 0;
  private activeWorkers: number = 0;

  private onProgress?: (progress: Partial<StreamProgress>) => void;
  private onChunkReceived?: (chunk: BufferChunk) => void;

  constructor(options: RangePipelineOptions) {
    this.url = options.url;
    this.totalBytes = options.totalBytes ?? 0;
    this.streamType = options.streamType ?? 'unified';
    this.signal = options.signal;
    this.onProgress = options.onProgress;
    this.onChunkReceived = options.onChunkReceived;

    this.aimd = new AimdConcurrencyController({
      initialConcurrency: options.initialConcurrency ?? 4,
    });
    this.chunkSizer = new DynamicChunkSizer({
      defaultChunkSize: options.initialChunkSize ?? 1024 * 1024,
    });
    this.ringBuffer = new OrderedSlidingRingBuffer({
      maxBufferBytes: options.maxBufferBytes ?? 32 * 1024 * 1024,
    });
  }

  public getRingBuffer(): OrderedSlidingRingBuffer {
    return this.ringBuffer;
  }

  public getDownloadedBytes(): number {
    return this.downloadedBytes;
  }

  public getTotalBytes(): number {
    return this.totalBytes;
  }

  public getActiveConcurrency(): number {
    return this.aimd.getConcurrency();
  }

  public getCurrentChunkSize(): number {
    return this.chunkSizer.getChunkSize();
  }

  public pause(): void {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
  }

  public resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    if (this.pausePromiseResolve) {
      this.pausePromiseResolve();
      this.pausePromiseResolve = null;
    }
  }

  private async checkPause(): Promise<void> {
    if (!this.isPaused) return;
    await new Promise<void>((resolve) => {
      this.pausePromiseResolve = resolve;
    });
  }

  /**
   * Starts the parallel range pipeline workers
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // If total length is unknown, probe HEAD or range 0-0 first
    if (this.totalBytes <= 0) {
      await this.probeLength();
    }

    try {
      await this.runWorkerPool();
    } finally {
      this.ringBuffer.close();
      this.isRunning = false;
    }
  }

  private async probeLength(): Promise<void> {
    try {
      const resp = await fetch(this.url, {
        method: 'HEAD',
        signal: this.signal,
        mode: 'cors',
        credentials: 'omit',
      });
      const cl = resp.headers.get('content-length');
      if (cl) {
        this.totalBytes = parseInt(cl, 10);
      }
    } catch {
      // Fallback: Range 0-0 probe
      try {
        const resp = await fetch(this.url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          signal: this.signal,
          mode: 'cors',
          credentials: 'omit',
        });
        const cr = resp.headers.get('content-range');
        if (cr) {
          const match = cr.match(/\/(\d+)$/);
          if (match && match[1]) {
            this.totalBytes = parseInt(match[1], 10);
          }
        }
      } catch {
        // If length cannot be probed, single sequential mode is used
      }
    }
  }

  private async runWorkerPool(): Promise<void> {
    const workerPromises = new Set<Promise<void>>();

    // Loop until all bytes are queued or aborted
    while (
      (this.totalBytes === 0 || this.nextByteOffset < this.totalBytes) &&
      !this.signal?.aborted
    ) {
      await this.checkPause();

      // Check backpressure: if ring buffer is at high watermark, wait for consumer to drain
      if (this.ringBuffer.isHighWatermark()) {
        await this.ringBuffer.waitForDrain(this.signal);
      }

      const targetConcurrency = this.aimd.getConcurrency();

      if (workerPromises.size < targetConcurrency) {
        const chunkSize = this.chunkSizer.getChunkSize();
        const startOffset = this.nextByteOffset;
        const endOffset =
          this.totalBytes > 0
            ? Math.min(this.totalBytes - 1, startOffset + chunkSize - 1)
            : startOffset + chunkSize - 1;

        const chunkIndex = this.nextChunkIndex++;
        this.nextByteOffset = endOffset + 1;

        const workerPromise = this.fetchChunk(chunkIndex, startOffset, endOffset)
          .catch((err) => {
            if (this.signal?.aborted) return;
            console.warn(`[RangePipeline] Chunk ${chunkIndex} failed:`, err);
          })
          .finally(() => {
            workerPromises.delete(workerPromise);
          });

        workerPromises.add(workerPromise);
      } else {
        // Wait for at least one worker to finish
        await Promise.race(workerPromises);
      }
    }

    // Await any remaining in-flight chunk workers
    await Promise.all(workerPromises);
  }

  private async fetchChunk(
    chunkIndex: number,
    startOffset: number,
    endOffset: number,
    retries = 3
  ): Promise<void> {
    let attempt = 0;

    while (attempt <= retries && !this.signal?.aborted) {
      attempt++;
      const startTime = performance.now();

      try {
        const rangeHeader = `bytes=${startOffset}-${endOffset}`;
        const response = await fetch(this.url, {
          method: 'GET',
          headers: { Range: rangeHeader },
          signal: this.signal,
          mode: 'cors',
          credentials: 'omit',
        });

        const durationMs = Math.max(1, performance.now() - startTime);

        if (response.status === 429 || response.status === 503) {
          this.aimd.recordCongestion('http_429');
          // Back off before retry
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }

        if (!response.ok && response.status !== 206) {
          throw new Error(`HTTP_${response.status}`);
        }

        const arrayBuf = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuf);

        // Update AIMD & dynamic chunk sizing
        this.aimd.recordSuccess(durationMs, data.byteLength);
        this.chunkSizer.recordChunkTransfer(data.byteLength, durationMs);

        this.downloadedBytes += data.byteLength;

        const chunk: BufferChunk = {
          index: chunkIndex,
          data,
          byteOffset: startOffset,
          totalLength: this.totalBytes,
          streamType: this.streamType,
        };

        // Push into ordered ring buffer
        this.ringBuffer.pushChunk(chunk);
        this.onChunkReceived?.(chunk);

        // Notify progress
        this.onProgress?.({
          downloadedBytes: this.downloadedBytes,
          totalBytes: this.totalBytes,
          activeConcurrency: this.aimd.getConcurrency(),
          currentChunkSizeBytes: this.chunkSizer.getChunkSize(),
          bufferedBytes: this.ringBuffer.getBufferedBytes(),
          speedBytesPerSec: this.chunkSizer.getThroughputBytesPerSec(),
        });

        return; // Success!
      } catch (err: any) {
        if (this.signal?.aborted) return;

        this.aimd.recordCongestion('network_error');

        if (attempt > retries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
      }
    }
  }
}
