/**
 * MUXARO Zero-Wait Pipelined Stream Engine - Stage 2: Sliding Ring Buffer
 * apps/web/lib/stream-engine/ring-buffer.ts
 *
 * Ordered Sliding Ring Buffer with Backpressure:
 * - Capped at ~32MB in-memory threshold (prevents mobile/tab crashes)
 * - Ingests parallel out-of-order range chunks and reorders them monotonically
 * - Provides backpressure gating (pause downloaders when consumer is slower than network)
 */

export interface BufferChunk {
  index: number;
  data: Uint8Array;
  byteOffset: number;
  totalLength: number;
  streamType?: 'video' | 'audio' | 'unified';
}

export interface RingBufferOptions {
  maxBufferBytes?: number; // Default: 32MB (33,554,432 bytes)
  highWatermarkRatio?: number; // Default: 0.75 (24MB)
  lowWatermarkRatio?: number; // Default: 0.35 (11.2MB)
}

export class OrderedSlidingRingBuffer {
  private maxBufferBytes: number;
  private highWatermarkBytes: number;
  private lowWatermarkBytes: number;

  private currentBufferBytes: number = 0;
  private expectedNextIndex: number = 0;
  private pendingChunks = new Map<number, BufferChunk>();

  private isClosed: boolean = false;
  private drainWaiters: Array<() => void> = [];
  private dataWaiters: Array<(chunk: BufferChunk | null) => void> = [];

  constructor(options?: RingBufferOptions) {
    this.maxBufferBytes = options?.maxBufferBytes ?? 32 * 1024 * 1024;
    const highRatio = options?.highWatermarkRatio ?? 0.75;
    const lowRatio = options?.lowWatermarkRatio ?? 0.35;

    this.highWatermarkBytes = Math.floor(this.maxBufferBytes * highRatio);
    this.lowWatermarkBytes = Math.floor(this.maxBufferBytes * lowRatio);
  }

  public getBufferedBytes(): number {
    return this.currentBufferBytes;
  }

  public getMaxBufferBytes(): number {
    return this.maxBufferBytes;
  }

  public getPendingChunkCount(): number {
    return this.pendingChunks.size;
  }

  public getNextExpectedIndex(): number {
    return this.expectedNextIndex;
  }

  /**
   * Whether the buffer has exceeded the high watermark and downloaders should pause
   */
  public isHighWatermark(): boolean {
    return this.currentBufferBytes >= this.highWatermarkBytes;
  }

  /**
   * Asynchronously waits until the buffer drains below the low watermark
   */
  public async waitForDrain(signal?: AbortSignal): Promise<void> {
    if (!this.isHighWatermark() || this.isClosed) return;

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(new Error('Buffer drain aborted'));
      };

      const onDrain = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        const idx = this.drainWaiters.indexOf(onDrain);
        if (idx !== -1) this.drainWaiters.splice(idx, 1);
      };

      if (signal?.aborted) {
        return reject(new Error('Buffer drain aborted'));
      }

      signal?.addEventListener('abort', onAbort);
      this.drainWaiters.push(onDrain);
    });
  }

  /**
   * Inserts a completed chunk into the buffer.
   * If the chunk matches expectedNextIndex, it is ready for immediate consumption.
   */
  public pushChunk(chunk: BufferChunk): void {
    if (this.isClosed) return;

    this.pendingChunks.set(chunk.index, chunk);
    this.currentBufferBytes += chunk.data.byteLength;

    this.flushAvailableToWaiters();
  }

  /**
   * Retrieves the next in-order chunk, or waits asynchronously until it arrives
   */
  public async popNextOrderedChunk(signal?: AbortSignal): Promise<BufferChunk | null> {
    // 1. Check if next in-order chunk is already buffered
    if (this.pendingChunks.has(this.expectedNextIndex)) {
      return this.consumeChunk(this.expectedNextIndex);
    }

    if (this.isClosed && this.pendingChunks.size === 0) {
      return null;
    }

    // 2. Wait for next chunk to arrive
    return new Promise<BufferChunk | null>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(new Error('Buffer read aborted'));
      };

      const onData = (chunk: BufferChunk | null) => {
        cleanup();
        resolve(chunk);
      };

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        const idx = this.dataWaiters.indexOf(onData);
        if (idx !== -1) this.dataWaiters.splice(idx, 1);
      };

      if (signal?.aborted) {
        return reject(new Error('Buffer read aborted'));
      }

      signal?.addEventListener('abort', onAbort);
      this.dataWaiters.push(onData);
    });
  }

  private consumeChunk(index: number): BufferChunk {
    const chunk = this.pendingChunks.get(index)!;
    this.pendingChunks.delete(index);
    this.expectedNextIndex++;
    this.currentBufferBytes -= chunk.data.byteLength;

    // Trigger drain waiters if buffer dropped below low watermark
    if (this.currentBufferBytes <= this.lowWatermarkBytes && this.drainWaiters.length > 0) {
      const waiters = [...this.drainWaiters];
      this.drainWaiters = [];
      for (const waiter of waiters) {
        waiter();
      }
    }

    return chunk;
  }

  private flushAvailableToWaiters(): void {
    while (this.dataWaiters.length > 0 && this.pendingChunks.has(this.expectedNextIndex)) {
      const waiter = this.dataWaiters.shift()!;
      const chunk = this.consumeChunk(this.expectedNextIndex);
      waiter(chunk);
    }

    if (this.isClosed && this.pendingChunks.size === 0) {
      while (this.dataWaiters.length > 0) {
        const waiter = this.dataWaiters.shift()!;
        waiter(null);
      }
    }
  }

  /**
   * Closes the buffer (no more chunks will be pushed)
   */
  public close(): void {
    this.isClosed = true;
    this.flushAvailableToWaiters();
    // Wake any paused drain waiters
    for (const waiter of this.drainWaiters) {
      waiter();
    }
    this.drainWaiters = [];
  }

  /**
   * Resets the buffer state and discards pending chunks
   */
  public reset(): void {
    this.isClosed = false;
    this.pendingChunks.clear();
    this.currentBufferBytes = 0;
    this.expectedNextIndex = 0;
    this.drainWaiters = [];
    this.dataWaiters = [];
  }
}
