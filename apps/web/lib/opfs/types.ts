/**
 * MUXARO Origin Private File System (OPFS) - Types and Contracts
 * apps/web/lib/opfs/types.ts
 *
 * Types for zero-RAM 4K/8K stream accumulation and disk streaming.
 */

export type OPFSErrorCode =
  | 'NOT_SUPPORTED'
  | 'QUOTA_EXCEEDED'
  | 'ABORTED'
  | 'INVALID_STATE'
  | 'IO_ERROR'
  | 'PERMISSION_DENIED';

export class OPFSError extends Error {
  public code: OPFSErrorCode;
  public details?: unknown;

  constructor(message: string, code: OPFSErrorCode, details?: unknown) {
    super(message);
    this.name = 'OPFSError';
    this.code = code;
    this.details = details;
  }
}

export interface StorageQuotaInfo {
  quota: number;        // Total bytes allocated/allowed
  usage: number;        // Bytes currently used
  available: number;    // Remaining bytes before quota is exceeded
  percentUsed: number;  // Usage percentage (0 - 100)
  canFit: (requiredBytes: number) => boolean;
}

export interface OPFSWriterOptions {
  /** Target filename or temp identifier */
  fileName?: string;
  /** Expected MIME type (e.g. 'video/mp4', 'video/webm', 'audio/mp4') */
  mimeType?: string;
  /** Estimated total size in bytes for quota pre-flight validation */
  expectedSize?: number;
  /** Subdirectory inside OPFS root to prevent root clutter (default: 'muxaro_streams') */
  subDirectory?: string;
  /** If true, automatically falls back to IndexedDB/memory accumulator when OPFS is unsupported */
  allowFallback?: boolean;
  /** Progress callback fired after chunks are written to disk */
  onProgress?: (bytesWritten: number, totalExpectedBytes?: number) => void;
  /** Chunk write callback for instantaneous throughput calculations */
  onChunkWritten?: (chunkBytes: number, totalWritten: number) => void;
  /** Abort signal to cancel streaming */
  signal?: AbortSignal;
}

export interface OPFSFileMetadata {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  opfsPath: string;
  isFallback: boolean;
}

export type ExportMode = 'file-system' | 'browser-download' | 'blob-url';

export interface ExportToDiskOptions {
  /** Suggested filename presented in the file picker or download attribute */
  suggestedName?: string;
  /** Preferred export mechanism */
  preferredMode?: ExportMode;
  /** Callback reporting export progress (bytes transferred from OPFS to destination) */
  onProgress?: (bytesExported: number, totalBytes: number) => void;
  /** Automatically remove the OPFS temporary file after successful export (default: true) */
  cleanupAfterExport?: boolean;
}

export interface OPFSExportResult {
  mode: ExportMode;
  fileName: string;
  bytesExported: number;
  downloadUrl?: string;
  success: boolean;
}

export interface IStreamAccumulator {
  readonly isInitialized: boolean;
  readonly isClosed: boolean;
  readonly bytesWritten: number;
  readonly isFallbackMode: boolean;

  init(): Promise<void>;
  write(chunk: Uint8Array | ArrayBuffer | Blob): Promise<void>;
  close(): Promise<OPFSFileMetadata>;
  abort(reason?: string): Promise<void>;
  getFile(): Promise<File | Blob>;
  exportToDisk(options?: ExportToDiskOptions): Promise<OPFSExportResult>;
  cleanup(): Promise<void>;
}
