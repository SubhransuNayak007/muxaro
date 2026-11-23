/// <reference lib="webworker" />
/**
 * MUXARO FFmpeg Web Worker (TypeScript source)
 * Client-side media processing via ffmpeg.wasm running in dedicated Worker thread.
 */

import { FFmpegEngine } from './ffmpeg-engine';
import {
  WorkerRequestMessage,
  WorkerResponseMessage,
  FFmpegProgress,
} from './types';

const engine = new FFmpegEngine();

self.onmessage = async (e: MessageEvent<WorkerRequestMessage>) => {
  const msg = e.data;
  if (!msg || !msg.id) return;

  const { id, type } = msg;

  if (type === 'init') {
    try {
      const loadedFrom = await engine.load(msg.config);
      const res: WorkerResponseMessage = {
        id,
        type: 'init-ok',
        loadedFrom,
      };
      self.postMessage(res);
    } catch (err) {
      const res: WorkerResponseMessage = {
        id,
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(res);
    }
    return;
  }

  if (type === 'cancel') {
    engine.terminate();
    const res: WorkerResponseMessage = {
      id,
      type: 'error',
      error: 'Task cancelled by user.',
    };
    self.postMessage(res);
    return;
  }

  // Common progress & log callbacks
  const onProgress = (progress: FFmpegProgress) => {
    const res: WorkerResponseMessage = {
      id,
      type: 'progress',
      progress,
    };
    self.postMessage(res);
  };

  const onLog = (message: string) => {
    const res: WorkerResponseMessage = {
      id,
      type: 'log',
      message,
    };
    self.postMessage(res);
  };

  try {
    if (type === 'convert') {
      const result = await engine.convert({
        ...msg.payload,
        onProgress,
        onLog,
      });

      const buffer = await result.blob.arrayBuffer();
      const res: WorkerResponseMessage = {
        id,
        type: 'success',
        result: {
          buffer,
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          elapsedMs: result.elapsedMs,
          isStreamCopy: result.isStreamCopy,
        },
      };
      self.postMessage(res, [buffer]);
      return;
    }

    if (type === 'extract-audio') {
      const result = await engine.extractAudio({
        ...msg.payload,
        onProgress,
        onLog,
      });

      const buffer = await result.blob.arrayBuffer();
      const res: WorkerResponseMessage = {
        id,
        type: 'success',
        result: {
          buffer,
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          elapsedMs: result.elapsedMs,
          isStreamCopy: result.isStreamCopy,
        },
      };
      self.postMessage(res, [buffer]);
      return;
    }

    if (type === 'merge') {
      const result = await engine.merge({
        ...msg.payload,
        onProgress,
        onLog,
      });

      const buffer = await result.blob.arrayBuffer();
      const res: WorkerResponseMessage = {
        id,
        type: 'success',
        result: {
          buffer,
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          elapsedMs: result.elapsedMs,
          isStreamCopy: result.isStreamCopy,
        },
      };
      self.postMessage(res, [buffer]);
      return;
    }

    if (type === 'exec') {
      const result = await engine.exec({
        args: msg.payload.args,
        inputFiles: msg.payload.inputFiles.map((f) => ({
          name: f.name,
          data: f.buffer,
        })),
        outputFileName: msg.payload.outputFileName,
        outputMimeType: msg.payload.outputMimeType,
        onProgress,
        onLog,
      });

      const buffer = await result.blob.arrayBuffer();
      const res: WorkerResponseMessage = {
        id,
        type: 'success',
        result: {
          buffer,
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          elapsedMs: result.elapsedMs,
          isStreamCopy: result.isStreamCopy,
        },
      };
      self.postMessage(res, [buffer]);
      return;
    }
  } catch (err) {
    const res: WorkerResponseMessage = {
      id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};
