/**
 * Project MUXARO - Resumable 4GB Multipart Browser Uploader
 * Conforms to Architecture Part 6.2:
 * - IndexedDB state persistence across browser tabs and reloads
 * - 4 concurrent chunk worker streams
 * - Exponential backoff with jitter on transient failures
 * - Live pause(), resume(), cancel() controls
 * - Windowed live MB/s transfer speed and ETA calculation
 * - Handles up to 4GB files using non-buffering File.slice() Blobs
 */

import { readCsrfTokenFromCookie } from './api-client';

export type UploadSessionState =
  | 'idle'
  | 'initializing'
  | 'uploading'
  | 'paused'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MultipartUploadStats {
  percent: number;
  loadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  mbps: string;
  etaSeconds: number;
  activeWorkers: number;
  completedParts: number;
  totalParts: number;
  state: UploadSessionState;
  currentPart?: number;
}

export type UploadFlowMode = 'presigned' | 'chunked';

export interface StoredUploadSession {
  fileKey: string;
  uploadId: string;
  mode?: UploadFlowMode;
  filename: string;
  totalSize: number;
  chunkSize: number;
  totalParts: number;
  completedParts: number[];
  partEtags?: Array<[number, string]>;
  expiresAt: string;
  state: UploadSessionState;
  updatedAt: number;
}

export interface MultipartUploaderOptions {
  apiBase?: string;
  concurrency?: number;
  chunkSize?: number;
  maxRetries?: number;
  tool?: 'convert_video' | 'extract_audio' | 'merge_av' | 'batch_playlist';
  targetFormat?: string;
  onProgress?: (stats: MultipartUploadStats) => void;
  onStateChange?: (state: UploadSessionState) => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

const DB_NAME = 'muxaro_uploads_v2';
const STORE_NAME = 'sessions';
const DB_VERSION = 1;
const MAX_SERVERLESS_CHUNK_SIZE = Math.floor(3.5 * 1024 * 1024); // Strictly under Vercel 4.5 MB limit
const DEFAULT_CHUNK_SIZE = MAX_SERVERLESS_CHUNK_SIZE;
const PRESIGNED_PART_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_RETRIES = 4;
const SPEED_WINDOW_MS = 3500;

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this browser environment.'));
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

async function getStoredSession(fileKey: string): Promise<StoredUploadSession | null> {
  try {
    const db = await openIndexedDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(fileKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveStoredSession(session: StoredUploadSession): Promise<void> {
  try {
    const db = await openIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(session);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Non-fatal if IndexedDB storage write fails
  }
}

async function removeStoredSession(fileKey: string): Promise<void> {
  try {
    const db = await openIndexedDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(fileKey);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {
    // Non-fatal
  }
}

export function computeFileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

interface SpeedSample {
  timestamp: number;
  bytes: number;
}

export class ResumableMultipartUploader {
  private file: File;
  private fileKey: string;
  private apiBase: string;
  private concurrency: number;
  private chunkSize: number;
  private maxRetries: number;
  private tool: 'convert_video' | 'extract_audio' | 'merge_av' | 'batch_playlist';
  private targetFormat?: string;
  private onProgress?: (stats: MultipartUploadStats) => void;
  private onStateChange?: (state: UploadSessionState) => void;
  private onError?: (err: Error) => void;

  private state: UploadSessionState = 'idle';
  private mode: UploadFlowMode = 'chunked';
  private uploadId: string | null = null;
  private totalParts: number = 0;
  private completedParts: Set<number> = new Set();
  private partEtags: Map<number, string> = new Map();
  private presignedUrls: Map<number, string> = new Map();
  private activeWorkers: number = 0;
  private abortControllers: Map<number, AbortController> = new Map();
  private speedSamples: SpeedSample[] = [];
  private speedTrackerTimer: ReturnType<typeof setInterval> | null = null;
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private resolvePromise?: (result: any) => void;
  private rejectPromise?: (reason: any) => void;

  constructor(file: File, options: MultipartUploaderOptions = {}) {
    if (!file) {
      throw new Error('A valid File object is required for ResumableMultipartUploader.');
    }
    this.file = file;
    this.fileKey = computeFileKey(file);
    const isElectronDesktop =
      typeof window !== 'undefined' && Boolean((window as any).muxaroDesktop?.isDesktop);
    this.apiBase =
      options.apiBase ||
      (isElectronDesktop
        ? '/api/v1'
        : typeof window !== 'undefined' && (process.env.NEXT_PUBLIC_API_URL || '/api/v1')) ||
      '/api/v1';
    this.concurrency = Math.min(8, Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY));
    this.chunkSize = Math.min(MAX_SERVERLESS_CHUNK_SIZE, Math.max(256 * 1024, options.chunkSize ?? DEFAULT_CHUNK_SIZE));
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.tool = options.tool || 'convert_video';
    this.targetFormat = options.targetFormat;
    this.onProgress = options.onProgress;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;

    this.totalParts = Math.max(1, Math.ceil(this.file.size / this.chunkSize));

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        this.cancel();
      });
    }
  }

  public getStats(): MultipartUploadStats {
    const loaded = Math.min(this.file.size, this.completedParts.size * this.chunkSize);
    const percent = Math.min(100, Math.round((this.completedParts.size / this.totalParts) * 100));
    const speed = this.calculateInstantSpeed();
    const mbps = (speed / (1024 * 1024)).toFixed(2);
    const remainingBytes = Math.max(0, this.file.size - loaded);
    const etaSeconds = speed > 0 ? Math.ceil(remainingBytes / speed) : 0;

    return {
      percent,
      loadedBytes: loaded,
      totalBytes: this.file.size,
      speedBytesPerSec: speed,
      mbps,
      etaSeconds,
      activeWorkers: this.activeWorkers,
      completedParts: this.completedParts.size,
      totalParts: this.totalParts,
      state: this.state,
    };
  }

  private calculateInstantSpeed(): number {
    const now = Date.now();
    const cutoff = now - SPEED_WINDOW_MS;
    this.speedSamples = this.speedSamples.filter((s) => s.timestamp >= cutoff);
    if (this.speedSamples.length < 2) return 0;

    const totalBytes = this.speedSamples.reduce((acc, s) => acc + s.bytes, 0);
    const durationSec = (now - this.speedSamples[0].timestamp) / 1000;
    return durationSec > 0 ? Math.round(totalBytes / durationSec) : 0;
  }

  private setState(next: UploadSessionState): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange?.(next);
    this.emitProgress();
  }

  private emitProgress(currentPart?: number): void {
    if (this.onProgress) {
      const stats = this.getStats();
      if (currentPart !== undefined) {
        stats.currentPart = currentPart;
      }
      this.onProgress(stats);
    }
  }

  /**
   * Starts or resumes the multipart upload. Returns a Promise resolving to the inspected media manifest.
   */
  public async start(): Promise<any> {
    if (this.state === 'uploading') {
      return;
    }
    this.isPaused = false;
    this.isCancelled = false;

    return new Promise(async (resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;

      try {
        await this.initializeSession();
        this.setState('uploading');
        this.startSpeedTracker();
        await this.runWorkerPool();
      } catch (err: any) {
        this.cleanupSpeedTracker();
        if (this.isPaused) {
          this.setState('paused');
          return;
        }
        if (this.isCancelled) {
          this.setState('cancelled');
          return;
        }
        this.setState('failed');
        this.onError?.(err);
        reject(err);
      }
    });
  }

  /**
   * Pauses the upload gracefully by aborting active workers and persisting state.
   */
  public async pause(): Promise<void> {
    if (this.state !== 'uploading' && this.state !== 'initializing') return;
    this.isPaused = true;
    this.abortAllActiveRequests();
    this.cleanupSpeedTracker();
    this.setState('paused');
    await this.persistSession();
  }

  /**
   * Resumes a paused upload.
   */
  public async resume(): Promise<any> {
    if (this.state !== 'paused' && this.state !== 'failed') return;
    return this.start();
  }

  /**
   * Cancels the upload, deletes temp parts on server, and clears IndexedDB record.
   */
  public async cancel(): Promise<void> {
    this.isCancelled = true;
    this.abortAllActiveRequests();
    this.cleanupSpeedTracker();
    this.setState('cancelled');

    const uploadId = this.uploadId;
    if (uploadId) {
      try {
        const csrfToken = readCsrfTokenFromCookie();
        const abortEndpoint =
          this.mode === 'presigned'
            ? `${this.apiBase}/uploads/${encodeURIComponent(uploadId)}/abort`
            : `${this.apiBase}/media/upload/${encodeURIComponent(uploadId)}`;
        await fetch(abortEndpoint, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            ...(csrfToken ? { 'x-muxaro-csrf': csrfToken } : {}),
          },
        }).catch(() => {});
      } catch {
        // Non-fatal
      }
    }

    await removeStoredSession(this.fileKey);
    this.rejectPromise?.(new Error('Upload cancelled by user.'));
  }

  private abortAllActiveRequests(): void {
    this.abortControllers.forEach((ctrl) => {
      try {
        ctrl.abort();
      } catch {}
    });
    this.abortControllers.clear();
    this.activeWorkers = 0;
  }

  private startSpeedTracker(): void {
    this.cleanupSpeedTracker();
    this.speedTrackerTimer = setInterval(() => {
      if (this.state === 'uploading') {
        this.emitProgress();
      }
    }, 1000);
  }

  private cleanupSpeedTracker(): void {
    if (this.speedTrackerTimer) {
      clearInterval(this.speedTrackerTimer);
      this.speedTrackerTimer = null;
    }
  }

  private async initializeSession(): Promise<void> {
    this.setState('initializing');

    // 1. Check IndexedDB for existing session
    const stored = await getStoredSession(this.fileKey);
    if (stored && stored.uploadId && new Date(stored.expiresAt).getTime() > Date.now()) {
      this.mode = stored.mode || 'chunked';
      this.uploadId = stored.uploadId;
      this.completedParts = new Set(stored.completedParts || []);
      this.partEtags = new Map(stored.partEtags || []);
      this.chunkSize =
        this.mode === 'chunked'
          ? Math.min(MAX_SERVERLESS_CHUNK_SIZE, stored.chunkSize || this.chunkSize)
          : stored.chunkSize || this.chunkSize;
      this.totalParts = Math.max(1, Math.ceil(this.file.size / this.chunkSize));
      return;
    }

    const csrfToken = readCsrfTokenFromCookie();
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrfToken ? { 'x-muxaro-csrf': csrfToken } : {}),
    };

    // 2. Prefer canonical Fastify R2 presigned multipart flow (/api/v1/uploads/init)
    let presignedFallbackReason: string | null = null;
    try {
      const presignedRes = await fetch(`${this.apiBase}/uploads/init`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders,
        body: JSON.stringify({
          filename: this.file.name,
          sizeBytes: this.file.size,
          mimeType: this.file.type || 'application/octet-stream',
          tool: this.tool,
          ...(this.targetFormat ? { targetFormat: this.targetFormat } : {}),
        }),
      });

      if (presignedRes.ok) {
        const initData = await presignedRes.json();
        const data = initData.data || initData;
        const sessionId = data.uploadSessionId || data.uploadId;
        if (sessionId) {
          this.mode = data.mode === 'chunked' ? 'chunked' : 'presigned';
          this.uploadId = String(sessionId);
          this.chunkSize =
            this.mode === 'chunked'
              ? Math.min(MAX_SERVERLESS_CHUNK_SIZE, Number(data.chunkSizeHint || data.chunkSize) || MAX_SERVERLESS_CHUNK_SIZE)
              : Number(data.chunkSize) || 5 * 1024 * 1024;
          this.totalParts =
            Number(data.totalChunks) || Math.max(1, Math.ceil(this.file.size / this.chunkSize));
          this.completedParts.clear();
          this.partEtags.clear();
          this.presignedUrls.clear();
          await this.persistSession(data.expiresAt);
          return;
        }
      } else if (
        presignedRes.status !== 404 &&
        presignedRes.status !== 500 &&
        presignedRes.status !== 501 &&
        presignedRes.status !== 502 &&
        presignedRes.status !== 503 &&
        presignedRes.status !== 504
      ) {
        const errJson = await presignedRes.json().catch(() => ({}));
        const msg =
          errJson.error?.message ||
          errJson.error?.userMessage ||
          `Failed to initialize upload session (${presignedRes.status})`;
        const err = new Error(msg) as Error & { code?: string; status?: number };
        err.code = errJson.error?.code;
        err.status = presignedRes.status;
        throw err;
      } else {
        const errJson = await presignedRes.json().catch(() => ({}));
        presignedFallbackReason = errJson.error?.code || String(presignedRes.status);
      }
    } catch (err: any) {
      if (err?.status && err.status < 500 && err.status !== 404) {
        throw err;
      }
      presignedFallbackReason = err?.message || 'presigned_unavailable';
    }

    // 3. Fallback: chunked server upload (/api/v1/media/upload/init) strictly <= 3.5 MB chunks
    this.mode = 'chunked';
    this.chunkSize = Math.min(MAX_SERVERLESS_CHUNK_SIZE, this.chunkSize);
    this.totalParts = Math.max(1, Math.ceil(this.file.size / this.chunkSize));

    const initRes = await fetch(`${this.apiBase}/media/upload/init`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders,
      body: JSON.stringify({
        filename: this.file.name,
        totalSize: this.file.size,
        totalParts: this.totalParts,
      }),
    });

    if (!initRes.ok) {
      const errJson = await initRes.json().catch(() => ({}));
      const msg =
        errJson.error?.message ||
        errJson.error?.userMessage ||
        `Failed to initialize upload session (${initRes.status}${presignedFallbackReason ? `; presigned: ${presignedFallbackReason}` : ''})`;
      const err = new Error(msg) as Error & { code?: string; status?: number };
      err.code = errJson.error?.code;
      err.status = initRes.status;
      throw err;
    }

    const initData = await initRes.json();
    const data = initData.data || initData;

    this.uploadId = data.uploadId || data.uploadSessionId || data.assetId;
    if (data.chunkSizeHint && Number(data.chunkSizeHint) > 0) {
      this.chunkSize = Math.min(MAX_SERVERLESS_CHUNK_SIZE, Number(data.chunkSizeHint));
    }
    this.totalParts = Math.max(1, Math.ceil(this.file.size / this.chunkSize));
    this.completedParts.clear();
    this.partEtags.clear();
    this.presignedUrls.clear();

    await this.persistSession(data.expiresAt);
  }

  private async persistSession(expiresAt?: string): Promise<void> {
    if (!this.uploadId) return;
    const session: StoredUploadSession = {
      fileKey: this.fileKey,
      uploadId: this.uploadId,
      mode: this.mode,
      filename: this.file.name,
      totalSize: this.file.size,
      chunkSize: this.chunkSize,
      totalParts: this.totalParts,
      completedParts: Array.from(this.completedParts),
      partEtags: Array.from(this.partEtags.entries()),
      expiresAt: expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      state: this.state,
      updatedAt: Date.now(),
    };
    await saveStoredSession(session);
  }

  private async ensurePresignedUrls(partNumbers: number[]): Promise<void> {
    if (this.mode !== 'presigned' || !this.uploadId) return;
    const missing = partNumbers.filter((p) => !this.presignedUrls.has(p));
    if (missing.length === 0) return;

    const csrfToken = readCsrfTokenFromCookie();
    for (let i = 0; i < missing.length; i += PRESIGNED_PART_BATCH_SIZE) {
      const batch = missing.slice(i, i + PRESIGNED_PART_BATCH_SIZE);
      const res = await fetch(`${this.apiBase}/uploads/${encodeURIComponent(this.uploadId)}/parts`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(csrfToken ? { 'x-muxaro-csrf': csrfToken } : {}),
        },
        body: JSON.stringify({
          uploadSessionId: this.uploadId,
          partNumbers: batch,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Failed to obtain presigned upload URLs (${res.status})`);
      }

      const json = await res.json();
      const data = json.data || json;
      const parts: Array<{ partNumber: number; presignedUrl: string }> = data.parts || [];
      for (const part of parts) {
        if (part.partNumber && part.presignedUrl) {
          this.presignedUrls.set(part.partNumber, part.presignedUrl);
        }
      }
    }
  }

  private async runWorkerPool(): Promise<void> {
    // Generate queue of parts remaining
    const remainingParts: number[] = [];
    for (let partNum = 1; partNum <= this.totalParts; partNum++) {
      if (!this.completedParts.has(partNum)) {
        remainingParts.push(partNum);
      }
    }

    if (remainingParts.length === 0) {
      return this.finalizeUpload();
    }

    if (this.mode === 'presigned') {
      await this.ensurePresignedUrls(remainingParts);
    }

    let nextIndex = 0;
    let poolError: Error | null = null;

    const worker = async (workerId: number): Promise<void> => {
      while (nextIndex < remainingParts.length && !this.isPaused && !this.isCancelled && !poolError) {
        const partNum = remainingParts[nextIndex++];
        if (this.completedParts.has(partNum)) continue;

        try {
          this.activeWorkers++;
          await this.uploadPartWithRetry(partNum);
          this.activeWorkers--;
          this.completedParts.add(partNum);
          await this.persistSession();
          this.emitProgress(partNum);
        } catch (partErr: any) {
          this.activeWorkers--;
          if (this.isPaused || this.isCancelled) return;
          poolError = partErr;
          throw partErr;
        }
      }
    };

    const workerPromises: Promise<void>[] = [];
    const activeCount = Math.min(this.concurrency, remainingParts.length);
    for (let i = 0; i < activeCount; i++) {
      workerPromises.push(worker(i));
    }

    await Promise.all(workerPromises);

    if (this.isPaused || this.isCancelled) return;
    if (poolError) throw poolError;

    if (this.completedParts.size === this.totalParts) {
      await this.finalizeUpload();
    }
  }

  private async uploadPartWithRetry(partNumber: number): Promise<void> {
    let attempt = 0;
    const startByte = (partNumber - 1) * this.chunkSize;
    const endByte = Math.min(this.file.size, startByte + this.chunkSize);
    const chunkBlob = this.file.slice(startByte, endByte);

    while (attempt < this.maxRetries) {
      if (this.isPaused || this.isCancelled) {
        throw new Error('Upload paused or cancelled.');
      }

      const ctrl = new AbortController();
      this.abortControllers.set(partNumber, ctrl);

      try {
        let res: Response;
        if (this.mode === 'presigned') {
          await this.ensurePresignedUrls([partNumber]);
          const presignedUrl = this.presignedUrls.get(partNumber);
          if (!presignedUrl) {
            throw new Error(`Missing presigned URL for part ${partNumber}`);
          }
          res = await fetch(presignedUrl, {
            method: 'PUT',
            body: chunkBlob,
            signal: ctrl.signal,
          });
        } else {
          const csrfToken = readCsrfTokenFromCookie();
          const url = `${this.apiBase}/media/upload/${encodeURIComponent(this.uploadId!)}/part/${partNumber}`;
          res = await fetch(url, {
            method: 'PUT',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/octet-stream',
              ...(csrfToken ? { 'x-muxaro-csrf': csrfToken } : {}),
            },
            body: chunkBlob,
            signal: ctrl.signal,
          });
        }

        this.abortControllers.delete(partNumber);

        if (!res.ok) {
          if (this.mode === 'presigned' && res.status === 403) {
            this.presignedUrls.delete(partNumber);
          }
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Chunk ${partNumber} failed with status ${res.status}`);
        }

        if (this.mode === 'presigned') {
          const etag = (res.headers.get('etag') || res.headers.get('ETag') || '').trim();
          if (!etag) {
            throw new Error(
              `Storage response for part ${partNumber} did not expose an ETag header (verify R2 CORS ExposeHeaders includes ETag).`
            );
          }
          this.partEtags.set(partNumber, etag);
        }

        // Record speed sample
        this.speedSamples.push({
          timestamp: Date.now(),
          bytes: chunkBlob.size,
        });

        return;
      } catch (err: any) {
        this.abortControllers.delete(partNumber);
        if (this.isPaused || this.isCancelled || err.name === 'AbortError') {
          throw err;
        }

        attempt++;
        if (attempt >= this.maxRetries) {
          throw new Error(`Part ${partNumber} failed after ${this.maxRetries} attempts: ${err.message}`);
        }

        // Exponential backoff with jitter
        const delay = Math.min(8000, 400 * Math.pow(2, attempt) + Math.random() * 200);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async finalizeUpload(): Promise<void> {
    this.setState('completing');
    this.cleanupSpeedTracker();

    const csrfToken = readCsrfTokenFromCookie();
    const completeUrl =
      this.mode === 'presigned'
        ? `${this.apiBase}/uploads/${encodeURIComponent(this.uploadId!)}/complete`
        : `${this.apiBase}/media/upload/${encodeURIComponent(this.uploadId!)}/complete`;

    const completeBody =
      this.mode === 'presigned'
        ? {
            uploadSessionId: this.uploadId!,
            parts: Array.from(this.partEtags.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([partNumber, etag]) => ({ partNumber, etag })),
          }
        : {
            filename: this.file.name,
          };

    const compRes = await fetch(completeUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(csrfToken ? { 'x-muxaro-csrf': csrfToken } : {}),
      },
      body: JSON.stringify(completeBody),
    });

    if (!compRes.ok) {
      const errData = await compRes.json().catch(() => ({}));
      const msg = errData.error?.message || errData.error?.userMessage || `Failed to finalize upload (${compRes.status})`;
      this.setState('failed');
      throw new Error(msg);
    }

    const compData = await compRes.json();
    const rawResult = compData.data || compData;
    const resolvedId =
      rawResult.assetId || rawResult.id || rawResult.uploadId || rawResult.uploadSessionId || this.uploadId;
    const result = {
      ...rawResult,
      id: resolvedId,
      assetId: resolvedId,
      uploadId: rawResult.uploadId || rawResult.uploadSessionId || resolvedId,
      uploadSessionId: rawResult.uploadSessionId || rawResult.uploadId || resolvedId,
      filename: rawResult.filename || this.file.name,
      sizeBytes: rawResult.sizeBytes ?? this.file.size,
      mimeType: rawResult.mimeType || this.file.type || 'application/octet-stream',
    };

    await removeStoredSession(this.fileKey);
    this.setState('completed');
    this.resolvePromise?.(result);
  }
}

export default ResumableMultipartUploader;

