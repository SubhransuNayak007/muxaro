/**
 * MUXARO FFmpeg Client-Side Engine Types
 * High-performance browser-based media processing via ffmpeg.wasm & Web Workers.
 */

export type ContainerFormat = 'mp4' | 'mkv' | 'webm' | 'mov' | 'avi';

export type AudioFormat =
  | 'copy'
  | 'native'
  | 'mp3'
  | 'aac'
  | 'm4a'
  | 'wav'
  | 'flac'
  | 'opus'
  | 'ogg';

export interface FFmpegProgress {
  ratio: number; // 0.0 to 1.0
  percent: number; // 0 to 100
  timeSeconds?: number;
  timeFormatted?: string; // HH:MM:SS
  speed?: string; // e.g. "45.2x"
  fps?: number;
  message?: string;
}

export interface BaseTaskOptions {
  fileName?: string;
  signal?: AbortSignal;
  onProgress?: (progress: FFmpegProgress) => void;
  onLog?: (message: string) => void;
}

export interface ConvertTaskOptions extends BaseTaskOptions {
  file: File | Blob;
  targetContainer: ContainerFormat;
  /**
   * Default: true.
   * Uses `-c copy` / `-c:v copy -c:a copy` for ultra-fast (2–5s) lossless remuxing.
   */
  streamCopy?: boolean;
  videoCodec?: string;
  audioCodec?: string;
}

export interface ExtractAudioTaskOptions extends BaseTaskOptions {
  file: File | Blob;
  /**
   * Target audio format.
   * Default: 'copy' / 'native' (lossless extraction via `-vn -c:a copy`).
   */
  targetFormat?: AudioFormat;
  /**
   * Default: true.
   * Extracts original audio stream without re-encoding.
   */
  streamCopy?: boolean;
  bitrateKbps?: number; // e.g. 192, 320 for mp3/aac
}

export interface MergeTaskOptions extends BaseTaskOptions {
  videoFile: File | Blob;
  videoFileName?: string;
  audioFile: File | Blob;
  audioFileName?: string;
  targetContainer?: ContainerFormat; // Default: 'mp4'
  /**
   * Default: true.
   * Remuxes video and audio streams using `-c:v copy -c:a copy` in 2-5s.
   */
  streamCopy?: boolean;
  /**
   * Optional audio delay or sync adjustment in milliseconds.
   */
  audioDelayMs?: number;
}

export interface CustomExecTaskOptions extends BaseTaskOptions {
  args: string[];
  inputFiles: Array<{
    name: string;
    data: File | Blob | Uint8Array | ArrayBuffer;
  }>;
  outputFileName: string;
  outputMimeType?: string;
}

export type FFmpegTaskConfig =
  | ({ action: 'convert' } & ConvertTaskOptions)
  | ({ action: 'extract-audio' } & ExtractAudioTaskOptions)
  | ({ action: 'merge' } & MergeTaskOptions)
  | ({ action: 'exec' } & CustomExecTaskOptions);

export interface FFmpegTaskResult {
  blob: Blob;
  url: string; // Object URL for direct browser download
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  elapsedMs: number;
  isStreamCopy: boolean;
}

export interface FFmpegWorkerState {
  isReady: boolean;
  isLoading: boolean;
  isProcessing: boolean;
  progress: FFmpegProgress;
  error: string | null;
  loadedFrom: 'local' | 'cdn' | null;
}

// ---------------------------------------------------------------------------
// Worker RPC Protocol Messages
// ---------------------------------------------------------------------------

export type WorkerRequestMessage =
  | {
      id: string;
      type: 'init';
      config?: {
        coreURL?: string;
        wasmURL?: string;
      };
    }
  | {
      id: string;
      type: 'convert';
      payload: {
        file: Blob;
        fileName: string;
        targetContainer: ContainerFormat;
        streamCopy?: boolean;
        videoCodec?: string;
        audioCodec?: string;
      };
    }
  | {
      id: string;
      type: 'extract-audio';
      payload: {
        file: Blob;
        fileName: string;
        targetFormat: AudioFormat;
        streamCopy?: boolean;
        bitrateKbps?: number;
      };
    }
  | {
      id: string;
      type: 'merge';
      payload: {
        videoFile: Blob;
        videoFileName: string;
        audioFile: Blob;
        audioFileName: string;
        targetContainer: ContainerFormat;
        streamCopy?: boolean;
        audioDelayMs?: number;
      };
    }
  | {
      id: string;
      type: 'exec';
      payload: {
        args: string[];
        inputFiles: Array<{ name: string; buffer: ArrayBuffer }>;
        outputFileName: string;
        outputMimeType?: string;
      };
    }
  | {
      id: string;
      type: 'cancel';
    };

export type WorkerResponseMessage =
  | {
      id: string;
      type: 'init-ok';
      loadedFrom: 'local' | 'cdn';
    }
  | {
      id: string;
      type: 'progress';
      progress: FFmpegProgress;
    }
  | {
      id: string;
      type: 'log';
      message: string;
    }
  | {
      id: string;
      type: 'success';
      result: {
        buffer: ArrayBuffer;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        elapsedMs: number;
        isStreamCopy: boolean;
      };
    }
  | {
      id: string;
      type: 'error';
      error: string;
    };
