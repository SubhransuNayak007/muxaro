/**
 * MUXARO FFmpeg Worker Client
 * High-level typed client communicating with the shared Web Worker.
 * Automatically manages worker pooling, fallback to in-thread FFmpegEngine if workers are disabled,
 * cancellation with AbortSignal, and typed promise resolution.
 */

import type {
  ConvertTaskOptions,
  ExtractAudioTaskOptions,
  MergeTaskOptions,
  CustomExecTaskOptions,
  FFmpegTaskConfig,
  FFmpegTaskResult,
  FFmpegProgress,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from './types.ts';
import { FFmpegEngine } from './ffmpeg-engine.ts';

export class FFmpegWorkerClient {
  private static instance: FFmpegWorkerClient | null = null;
  private worker: Worker | null = null;
  private fallbackEngine: FFmpegEngine | null = null;
  private isInitializing = false;
  private isReady = false;
  private initPromise: Promise<void> | null = null;
  private callbacks: Map<
    string,
    {
      resolve: (res: FFmpegTaskResult) => void;
      reject: (err: Error) => void;
      onProgress?: (progress: FFmpegProgress) => void;
      onLog?: (log: string) => void;
    }
  > = new Map();

  /**
   * Singleton accessor for shared worker instance.
   */
  public static getInstance(): FFmpegWorkerClient {
    if (!FFmpegWorkerClient.instance) {
      FFmpegWorkerClient.instance = new FFmpegWorkerClient();
    }
    return FFmpegWorkerClient.instance;
  }

  /**
   * Initializes the shared background Web Worker first, falling back to in-thread FFmpegEngine
   * only when Web Workers are unavailable or fail to initialize.
   */
  public async init(config?: { coreURL?: string; wasmURL?: string }): Promise<void> {
    if (this.isReady && (this.worker || this.fallbackEngine)) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.isInitializing = true;
      try {
        if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
          try {
            const worker = new Worker('/workers/ffmpeg-worker.js');
            this.worker = worker;
            this.setupWorkerListeners();

            await new Promise<void>((resolve, reject) => {
              const id = `init_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const timer = setTimeout(() => {
                this.callbacks.delete(id);
                reject(new Error('FFmpeg worker init timeout (60s).'));
              }, 60000);

              this.callbacks.set(id, {
                resolve: () => {
                  clearTimeout(timer);
                  resolve();
                },
                reject: (err) => {
                  clearTimeout(timer);
                  reject(err);
                },
              });

              const msg: WorkerRequestMessage = {
                id,
                type: 'init',
                config,
              };
              worker.postMessage(msg);
            });

            this.isReady = true;
            return;
          } catch (workerErr) {
            console.warn(
              '[FFmpegWorkerClient] Failed to initialize dedicated Web Worker, falling back to in-thread FFmpegEngine.',
              workerErr
            );
            if (this.worker) {
              try {
                this.worker.terminate();
              } catch {}
              this.worker = null;
            }
          }
        }

        if (!this.fallbackEngine) {
          this.fallbackEngine = new FFmpegEngine();
        }
        await this.fallbackEngine.load(config);
        this.isReady = true;
      } catch (err) {
        console.error('[FFmpegWorkerClient] Failed to initialize in-browser FFmpegEngine:', err);
        this.isReady = false;
        this.initPromise = null;
        throw err;
      } finally {
        this.isInitializing = false;
      }
    })();

    return this.initPromise;
  }

  private setupWorkerListeners(): void {
    if (!this.worker) return;

    this.worker.onmessage = (e: MessageEvent<WorkerResponseMessage>) => {
      const msg = e.data;
      if (!msg || !msg.id) return;

      const handler = this.callbacks.get(msg.id);
      if (!handler) return;

      if (msg.type === 'init-ok') {
        handler.resolve({} as FFmpegTaskResult);
        this.callbacks.delete(msg.id);
        return;
      }

      if (msg.type === 'progress') {
        handler.onProgress?.(msg.progress);
        return;
      }

      if (msg.type === 'log') {
        handler.onLog?.(msg.message);
        return;
      }

      if (msg.type === 'success') {
        const { buffer, fileName, mimeType, sizeBytes, elapsedMs, isStreamCopy } = msg.result;
        const blob = new Blob([buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);
        handler.resolve({
          blob,
          url,
          fileName,
          mimeType,
          sizeBytes,
          elapsedMs,
          isStreamCopy,
        });
        this.callbacks.delete(msg.id);
        return;
      }

      if (msg.type === 'error') {
        handler.reject(new Error(msg.error));
        this.callbacks.delete(msg.id);
        return;
      }
    };

    this.worker.onerror = (errEvent) => {
      console.error('[FFmpegWorkerClient] Worker error event:', errEvent);
      this.callbacks.forEach((cb, id) => {
        cb.reject(new Error(`Worker execution failed: ${errEvent.message || 'unknown error'}`));
        this.callbacks.delete(id);
      });
      if (this.worker) {
        try {
          this.worker.terminate();
        } catch {}
        this.worker = null;
      }
      this.isReady = false;
      this.isInitializing = false;
      this.initPromise = null;
    };
  }

  /**
   * Converts video container with default stream copy.
   */
  public async convert(options: ConvertTaskOptions): Promise<FFmpegTaskResult> {
    await this.init();

    if (!this.worker && this.fallbackEngine) {
      return this.fallbackEngine.convert(options);
    }

    const id = `convert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fileName = options.fileName || (options.file instanceof File ? options.file.name : 'video.mp4');

    return new Promise((resolve, reject) => {
      this.callbacks.set(id, {
        resolve,
        reject,
        onProgress: options.onProgress,
        onLog: options.onLog,
      });

      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            this.callbacks.delete(id);
            this.worker?.postMessage({ id, type: 'cancel' });
            reject(new DOMException('Operation aborted.', 'AbortError'));
          },
          { once: true }
        );
      }

      const msg: WorkerRequestMessage = {
        id,
        type: 'convert',
        payload: {
          file: options.file,
          fileName,
          targetContainer: options.targetContainer,
          streamCopy: options.streamCopy,
          videoCodec: options.videoCodec,
          audioCodec: options.audioCodec,
        },
      };

      this.worker?.postMessage(msg);
    });
  }

  /**
   * Extracts audio track with default stream copy.
   */
  public async extractAudio(options: ExtractAudioTaskOptions): Promise<FFmpegTaskResult> {
    await this.init();

    if (!this.worker && this.fallbackEngine) {
      return this.fallbackEngine.extractAudio(options);
    }

    const id = `extract_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fileName = options.fileName || (options.file instanceof File ? options.file.name : 'video.mp4');

    return new Promise((resolve, reject) => {
      this.callbacks.set(id, {
        resolve,
        reject,
        onProgress: options.onProgress,
        onLog: options.onLog,
      });

      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            this.callbacks.delete(id);
            this.worker?.postMessage({ id, type: 'cancel' });
            reject(new DOMException('Operation aborted.', 'AbortError'));
          },
          { once: true }
        );
      }

      const msg: WorkerRequestMessage = {
        id,
        type: 'extract-audio',
        payload: {
          file: options.file,
          fileName,
          targetFormat: options.targetFormat || 'copy',
          streamCopy: options.streamCopy,
          bitrateKbps: options.bitrateKbps,
        },
      };

      this.worker?.postMessage(msg);
    });
  }

  /**
   * Merges separate video and audio files into a unified container.
   */
  public async merge(options: MergeTaskOptions): Promise<FFmpegTaskResult> {
    await this.init();

    if (!this.worker && this.fallbackEngine) {
      return this.fallbackEngine.merge(options);
    }

    const id = `merge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const videoFileName =
      options.videoFileName ||
      (options.videoFile instanceof File ? options.videoFile.name : 'video.mp4');
    const audioFileName =
      options.audioFileName ||
      (options.audioFile instanceof File ? options.audioFile.name : 'audio.m4a');

    return new Promise((resolve, reject) => {
      this.callbacks.set(id, {
        resolve,
        reject,
        onProgress: options.onProgress,
        onLog: options.onLog,
      });

      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            this.callbacks.delete(id);
            this.worker?.postMessage({ id, type: 'cancel' });
            reject(new DOMException('Operation aborted.', 'AbortError'));
          },
          { once: true }
        );
      }

      const msg: WorkerRequestMessage = {
        id,
        type: 'merge',
        payload: {
          videoFile: options.videoFile,
          videoFileName,
          audioFile: options.audioFile,
          audioFileName,
          targetContainer: options.targetContainer || 'mp4',
          streamCopy: options.streamCopy,
          audioDelayMs: options.audioDelayMs,
        },
      };

      this.worker?.postMessage(msg);
    });
  }

  /**
   * Executes a custom task configuration.
   */
  public async runTask(config: FFmpegTaskConfig): Promise<FFmpegTaskResult> {
    if (config.action === 'convert') {
      return this.convert(config);
    }
    if (config.action === 'extract-audio') {
      return this.extractAudio(config);
    }
    if (config.action === 'merge') {
      return this.merge(config);
    }
    if (config.action === 'exec') {
      await this.init();
      if (!this.worker && this.fallbackEngine) {
        return this.fallbackEngine.exec(config);
      }
      const inputBuffers: Array<{ name: string; buffer: ArrayBuffer }> = [];
      for (const input of config.inputFiles) {
        let buffer: ArrayBuffer;
        if (input.data instanceof ArrayBuffer) {
          buffer = input.data;
        } else if (input.data instanceof Uint8Array) {
          buffer = input.data.buffer.slice(
            input.data.byteOffset,
            input.data.byteOffset + input.data.byteLength
          ) as ArrayBuffer;
        } else {
          buffer = await input.data.arrayBuffer();
        }
        inputBuffers.push({ name: input.name, buffer });
      }

      const id = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      return new Promise((resolve, reject) => {
        this.callbacks.set(id, {
          resolve,
          reject,
          onProgress: config.onProgress,
          onLog: config.onLog,
        });

        if (config.signal) {
          config.signal.addEventListener(
            'abort',
            () => {
              this.callbacks.delete(id);
              this.worker?.postMessage({ id, type: 'cancel' });
              reject(new DOMException('Operation aborted.', 'AbortError'));
            },
            { once: true }
          );
        }

        const msg: WorkerRequestMessage = {
          id,
          type: 'exec',
          payload: {
            args: config.args,
            inputFiles: inputBuffers,
            outputFileName: config.outputFileName,
            outputMimeType: config.outputMimeType,
          },
        };

        this.worker?.postMessage(msg);
      });
    }
    throw new Error(`Unsupported task action: ${(config as { action: string }).action}`);
  }

  /**
   * Terminates active worker or fallback engine.
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.fallbackEngine) {
      this.fallbackEngine.terminate();
      this.fallbackEngine = null;
    }
    this.isReady = false;
    this.isInitializing = false;
    this.initPromise = null;
    this.callbacks.clear();
  }
}
