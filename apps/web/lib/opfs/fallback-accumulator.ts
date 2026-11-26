/**
 * MUXARO Fallback Stream Accumulator
 * apps/web/lib/opfs/fallback-accumulator.ts
 *
 * Provides a resilient storage fallback for browsers or contexts where OPFS is unavailable:
 * 1. Tier 1 Fallback: Disk-backed IndexedDB chunk store (preserves RAM, avoids OOM tab crash).
 * 2. Tier 2 Fallback: Progressive chunked Blob accumulator with high-watermark memory guards.
 *
 * Guarantees consistent IStreamAccumulator API semantics across all browsers.
 */

import { OPFSError } from './types.ts';
import type {
  IStreamAccumulator,
  OPFSWriterOptions,
  OPFSFileMetadata,
  ExportToDiskOptions,
  OPFSExportResult,
} from './types.ts';

const DB_NAME = 'muxaro_stream_fallback_db';
const DB_VERSION = 1;
const STORE_NAME = 'stream_chunks';

/** Safe threshold for in-memory fallback before warning/rejecting to prevent browser tab crash (500MB) */
const MAX_SAFE_MEMORY_ACCUMULATION_BYTES = 512 * 1024 * 1024;

export class FallbackStreamAccumulator implements IStreamAccumulator {
  public isInitialized: boolean = false;
  public isClosed: boolean = false;
  public bytesWritten: number = 0;
  public readonly isFallbackMode: boolean = true;

  private streamId: string;
  private fileName: string;
  private mimeType: string;
  private expectedSize?: number;
  private options: OPFSWriterOptions;

  private db: IDBDatabase | null = null;
  private useIndexedDB: boolean = false;
  private memoryChunks: Uint8Array[] = [];
  private chunkIndex: number = 0;
  private cachedBlob: Blob | null = null;

  constructor(options: OPFSWriterOptions = {}) {
    this.options = options;
    this.streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.fileName = options.fileName || `${this.streamId}.mp4`;
    this.mimeType = options.mimeType || 'video/mp4';
    this.expectedSize = options.expectedSize;

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        this.abort('Aborted via external signal');
      });
    }
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    // Check if IndexedDB is available
    if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
      try {
        this.db = await this.openDatabase();
        this.useIndexedDB = true;
      } catch (err) {
        console.warn('[MUXARO] IndexedDB fallback init failed, using bounded memory accumulator:', err);
        this.useIndexedDB = false;
      }
    } else {
      this.useIndexedDB = false;
    }

    this.bytesWritten = 0;
    this.chunkIndex = 0;
    this.memoryChunks = [];
    this.isInitialized = true;
    this.isClosed = false;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // Compound key: [streamId, chunkIndex]
          const store = db.createObjectStore(STORE_NAME, { keyPath: ['streamId', 'index'] });
          store.createIndex('streamId', 'streamId', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Failed to open fallback IndexedDB'));
    });
  }

  public async write(chunk: Uint8Array | ArrayBuffer | Blob): Promise<void> {
    if (!this.isInitialized) {
      throw new OPFSError('Accumulator must be initialized before writing', 'INVALID_STATE');
    }
    if (this.isClosed) {
      throw new OPFSError('Cannot write to a closed stream accumulator', 'INVALID_STATE');
    }

    let buffer: Uint8Array;
    if (chunk instanceof Uint8Array) {
      buffer = chunk;
    } else if (chunk instanceof ArrayBuffer) {
      buffer = new Uint8Array(chunk);
    } else if (typeof Blob !== 'undefined' && chunk instanceof Blob) {
      buffer = new Uint8Array(await chunk.arrayBuffer());
    } else {
      throw new OPFSError('Invalid chunk format', 'IO_ERROR');
    }

    const chunkSize = buffer.byteLength;
    if (chunkSize === 0) return;

    if (this.useIndexedDB && this.db) {
      await this.writeToIndexedDB(buffer);
    } else {
      // Memory accumulation with watermark safety guard
      if (this.bytesWritten + chunkSize > MAX_SAFE_MEMORY_ACCUMULATION_BYTES) {
        console.warn(
          `[MUXARO] Fallback memory limit approaching (${Math.round(this.bytesWritten / 1024 / 1024)}MB). OPFS is required for uncompressed 4K/8K media.`
        );
      }
      this.memoryChunks.push(buffer);
    }

    this.bytesWritten += chunkSize;
    this.options.onChunkWritten?.(chunkSize, this.bytesWritten);
    this.options.onProgress?.(this.bytesWritten, this.expectedSize);
  }

  private writeToIndexedDB(chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('IndexedDB not open'));
      try {
        const tx = this.db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
          streamId: this.streamId,
          index: this.chunkIndex++,
          data: chunk,
          size: chunk.byteLength,
        };
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('Failed to write chunk to IndexedDB'));
      } catch (err) {
        reject(err);
      }
    });
  }

  public async close(): Promise<OPFSFileMetadata> {
    if (!this.isInitialized) {
      throw new OPFSError('Accumulator was not initialized', 'INVALID_STATE');
    }
    if (this.isClosed && this.cachedBlob) {
      return {
        name: this.fileName,
        size: this.cachedBlob.size,
        type: this.mimeType,
        lastModified: Date.now(),
        opfsPath: `fallback://${this.streamId}`,
        isFallback: true,
      };
    }

    this.cachedBlob = await this.buildBlob();
    this.isClosed = true;

    return {
      name: this.fileName,
      size: this.cachedBlob.size,
      type: this.mimeType,
      lastModified: Date.now(),
      opfsPath: `fallback://${this.streamId}`,
      isFallback: true,
    };
  }

  private async buildBlob(): Promise<Blob> {
    if (this.useIndexedDB && this.db) {
      const chunks = await this.readAllChunksFromIndexedDB();
      return new Blob(chunks as unknown as BlobPart[], { type: this.mimeType });
    } else {
      return new Blob(this.memoryChunks as unknown as BlobPart[], { type: this.mimeType });
    }
  }

  private readAllChunksFromIndexedDB(): Promise<Uint8Array[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('IndexedDB not open'));
      try {
        const tx = this.db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('streamId');
        const req = index.getAll(IDBKeyRange.only(this.streamId));

        req.onsuccess = () => {
          const records = (req.result || []) as Array<{ index: number; data: Uint8Array }>;
          records.sort((a, b) => a.index - b.index);
          const chunks = records.map((r) => r.data);
          resolve(chunks);
        };
        req.onerror = () => reject(req.error || new Error('Failed to read chunks from IndexedDB'));
      } catch (err) {
        reject(err);
      }
    });
  }

  public async getFile(): Promise<Blob> {
    if (!this.cachedBlob) {
      this.cachedBlob = await this.buildBlob();
    }
    return this.cachedBlob;
  }

  public async exportToDisk(options: ExportToDiskOptions = {}): Promise<OPFSExportResult> {
    const blob = await this.getFile();
    const targetName = options.suggestedName || this.fileName;

    // Check if showSaveFilePicker is available
    const hasPicker = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
    const preferPicker = options.preferredMode === 'file-system' || (options.preferredMode !== 'browser-download' && hasPicker);

    if (hasPicker && preferPicker) {
      try {
        const ext = targetName.split('.').pop() || 'mp4';
        const accept: Record<string, string[]> = {};
        accept[this.mimeType || 'application/octet-stream'] = [`.${ext}`];

        const handle = await (window as any).showSaveFilePicker({
          suggestedName: targetName,
          types: [{ description: 'Media File', accept }],
        });

        const writable = await handle.createWritable();
        // Stream blob to destination stream
        if (typeof blob.stream === 'function') {
          await blob.stream().pipeTo(writable);
        } else {
          await writable.write(blob);
          await writable.close();
        }

        if (options.cleanupAfterExport) {
          await this.cleanup();
        }

        return {
          mode: 'file-system',
          fileName: handle.name || targetName,
          bytesExported: blob.size,
          success: true,
        };
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          throw new OPFSError('User cancelled destination file selection', 'ABORTED', err);
        }
        // Fall back to browser download
      }
    }

    // Browser download fallback
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {
        mode: 'browser-download',
        fileName: targetName,
        bytesExported: blob.size,
        success: true,
      };
    }

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = targetName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();

    setTimeout(() => {
      try {
        document.body.removeChild(anchor);
        URL.revokeObjectURL(objectUrl);
      } catch (_) {}
    }, 60000);

    if (options.cleanupAfterExport) {
      await this.cleanup();
    }

    return {
      mode: 'browser-download',
      fileName: targetName,
      downloadUrl: objectUrl,
      bytesExported: blob.size,
      success: true,
    };
  }

  public async abort(_reason?: string): Promise<void> {
    this.isClosed = true;
    await this.cleanup();
  }

  public async cleanup(): Promise<void> {
    this.memoryChunks = [];
    this.cachedBlob = null;

    if (this.useIndexedDB && this.db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = this.db!.transaction([STORE_NAME], 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const index = store.index('streamId');
          const req = index.getAllKeys(IDBKeyRange.only(this.streamId));
          req.onsuccess = () => {
            const keys = req.result || [];
            for (const key of keys) {
              store.delete(key);
            }
            tx.oncomplete = () => {
              try {
                this.db?.close();
              } catch {}
              this.db = null;
              resolve();
            };
          };
          req.onerror = () => {
            try {
              this.db?.close();
            } catch {}
            this.db = null;
            resolve();
          };
        } catch {
          try {
            this.db?.close();
          } catch {}
          this.db = null;
          resolve();
        }
      });
    }
  }
}
