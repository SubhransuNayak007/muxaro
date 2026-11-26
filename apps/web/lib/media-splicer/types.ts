/**
 * @muxaro/media-splicer - Shared Types
 * Isomorphic across Browser Web Workers and Node.js.
 */

export type ContainerFamily = 'isom' | 'webm';

export interface SpliceSink {
  write(chunk: Uint8Array): Promise<void> | void;
  close?(): Promise<void> | void;
}

export interface SpliceFragment {
  ptsMs: number;
  bytes: Uint8Array;
}

export interface SpliceStats {
  container: ContainerFamily;
  videoFragments: number;
  audioFragments: number;
  bytesWritten: number;
  initBytes: number;
}

export interface SpliceDashOptions {
  videoChunks: AsyncIterable<Uint8Array>;
  audioChunks?: AsyncIterable<Uint8Array> | null;
  sink: SpliceSink;
  containerHint?: ContainerFamily;
  signal?: AbortSignal;
  onProgress?: (stats: SpliceStats) => void;
}

/**
 * Simple growable byte queue used by both ISOBMFF and WebM incremental readers
 * to slice box/cluster boundaries without quadratic copying.
 */
export class ByteQueue {
  private buf: Uint8Array = new Uint8Array(0);
  private head = 0;

  public get length(): number {
    return this.buf.byteLength - this.head;
  }

  public push(chunk: Uint8Array): void {
    if (!chunk || chunk.byteLength === 0) return;
    const unread = this.length;
    if (unread === 0) {
      this.buf = chunk;
      this.head = 0;
      return;
    }

    // Compact if dead prefix exceeds 256 KB or total buffer won't fit
    if (this.head > 0 && (this.head >= 262144 || this.buf.byteLength + chunk.byteLength > this.buf.byteLength * 2)) {
      const merged = new Uint8Array(unread + chunk.byteLength);
      merged.set(this.buf.subarray(this.head), 0);
      merged.set(chunk, unread);
      this.buf = merged;
      this.head = 0;
      return;
    }

    const merged = new Uint8Array(unread + chunk.byteLength);
    merged.set(this.buf.subarray(this.head), 0);
    merged.set(chunk, unread);
    this.buf = merged;
    this.head = 0;
  }

  public peek(): Uint8Array {
    return this.head === 0 ? this.buf : this.buf.subarray(this.head);
  }

  public consume(byteCount: number): Uint8Array {
    const view = this.buf.subarray(this.head, this.head + byteCount);
    this.head += byteCount;
    if (this.head === this.buf.byteLength) {
      this.buf = new Uint8Array(0);
      this.head = 0;
    }
    return view;
  }
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export function detectContainerFamily(bytes: Uint8Array): ContainerFamily | null {
  if (bytes.byteLength < 8) return null;
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'webm';
  }
  const fourcc = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (
    fourcc === 'ftyp' ||
    fourcc === 'styp' ||
    fourcc === 'moov' ||
    fourcc === 'moof' ||
    fourcc === 'sidx'
  ) {
    return 'isom';
  }
  return null;
}
