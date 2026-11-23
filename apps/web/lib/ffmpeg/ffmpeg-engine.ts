/**
 * MUXARO FFmpeg Core Engine
 * Client-side media processor utilizing @ffmpeg/ffmpeg, Emscripten virtual FS, and OPFS.
 * Enforces stream-copy (-c copy) by default for blazing fast 2–5s remuxing.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import {
  ContainerFormat,
  AudioFormat,
  ConvertTaskOptions,
  ExtractAudioTaskOptions,
  MergeTaskOptions,
  CustomExecTaskOptions,
  FFmpegProgress,
  FFmpegTaskResult,
} from './types';

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
};

function getMimeType(format: string): string {
  const clean = format.toLowerCase().replace(/^\./, '');
  return MIME_MAP[clean] || 'application/octet-stream';
}

function parseTimeToSeconds(timeStr: string): number | undefined {
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }
  return undefined;
}

export class FFmpegEngine {
  private ffmpeg: FFmpeg | null = null;
  private isLoaded = false;
  private loadedFrom: 'local' | 'cdn' | null = null;
  private activeFiles: Set<string> = new Set();
  private abortController: AbortController | null = null;

  /**
   * Initializes and loads the ffmpeg.wasm core.
   * Prioritizes local `/ffmpeg/ffmpeg-core.js` and `/ffmpeg/ffmpeg-core.wasm` (offline & CSP compliant).
   * Falls back to CDN if local files cannot be reached.
   */
  async load(config?: { coreURL?: string; wasmURL?: string }): Promise<'local' | 'cdn'> {
    if (this.isLoaded && this.ffmpeg) {
      return this.loadedFrom || 'local';
    }

    this.ffmpeg = new FFmpeg();

    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : typeof self !== 'undefined' && self.location
        ? self.location.origin
        : '';

    const localCore = config?.coreURL || `${origin}/ffmpeg/ffmpeg-core.js`;
    const localWasm = config?.wasmURL || `${origin}/ffmpeg/ffmpeg-core.wasm`;

    try {
      // Convert to Blob URLs for seamless internal Web Worker loading without cross-origin or path issues
      let coreBlob = localCore;
      let wasmBlob = localWasm;
      try {
        const [cRes, wRes] = await Promise.all([fetch(localCore), fetch(localWasm)]);
        if (cRes.ok && wRes.ok) {
          coreBlob = URL.createObjectURL(await cRes.blob());
          wasmBlob = URL.createObjectURL(await wRes.blob());
        }
      } catch {}

      await this.ffmpeg.load({
        coreURL: coreBlob,
        wasmURL: wasmBlob,
      });
      this.isLoaded = true;
      this.loadedFrom = 'local';
      return 'local';
    } catch (localErr) {
      console.warn('[FFmpegEngine] Local core load failed, attempting CDN fallback...', localErr);

      // Fallback: unpkg CDN
      try {
        const cdnCore = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js';
        const cdnWasm = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm';
        await this.ffmpeg.load({
          coreURL: cdnCore,
          wasmURL: cdnWasm,
        });
        this.isLoaded = true;
        this.loadedFrom = 'cdn';
        return 'cdn';
      } catch (cdnErr) {
        this.isLoaded = false;
        this.loadedFrom = null;
        throw new Error(
          `Failed to load ffmpeg.wasm from both local (/ffmpeg/) and CDN: ${
            cdnErr instanceof Error ? cdnErr.message : String(cdnErr)
          }`
        );
      }
    }
  }

  /**
   * Checks if FFmpeg is ready.
   */
  get ready(): boolean {
    return this.isLoaded && this.ffmpeg !== null;
  }

  /**
   * Safely writes file to in-memory virtual filesystem and registers for cleanup.
   */
  async writeFile(name: string, data: Uint8Array | ArrayBuffer | Blob): Promise<void> {
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded.');

    let bytes: Uint8Array;
    if (data instanceof Uint8Array) {
      bytes = data;
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else {
      const buffer = await data.arrayBuffer();
      bytes = new Uint8Array(buffer);
    }

    await this.ffmpeg.writeFile(name, bytes);
    this.activeFiles.add(name);
  }

  /**
   * Reads file from virtual filesystem.
   */
  async readFile(name: string): Promise<Uint8Array> {
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded.');
    const data = await this.ffmpeg.readFile(name);
    if (typeof data === 'string') {
      return new TextEncoder().encode(data);
    }
    return data;
  }

  /**
   * Deletes a file from virtual filesystem.
   */
  async deleteFile(name: string): Promise<void> {
    if (!this.ffmpeg) return;
    try {
      await this.ffmpeg.deleteFile(name);
    } catch {
      // Ignored if file doesn't exist
    } finally {
      this.activeFiles.delete(name);
    }
  }

  /**
   * Cleans up all active files in virtual filesystem to release memory.
   */
  async cleanup(): Promise<void> {
    if (!this.ffmpeg) return;
    for (const name of Array.from(this.activeFiles)) {
      await this.deleteFile(name);
    }
    this.activeFiles.clear();
  }

  /**
   * Converts/remuxes container format.
   * Default: lossless stream copy (-c copy) takes 2–5 seconds.
   */
  async convert(options: ConvertTaskOptions): Promise<FFmpegTaskResult> {
    await this.load();
    const startTime = performance.now();
    const isStreamCopy = options.streamCopy !== false;

    const baseName = options.fileName?.replace(/\.[^/.]+$/, '') || 'input_media';
    const inputExt = options.fileName?.split('.').pop() || 'mp4';
    const inputName = `input_${Date.now()}.${inputExt}`;
    const outputExt = options.targetContainer.toLowerCase();
    const outputName = `output_${Date.now()}.${outputExt}`;

    try {
      await this.writeFile(inputName, options.file);

      // Primary strategy: Stream copy
      let args: string[] = [];
      if (isStreamCopy) {
        if (outputExt === 'mp4') {
          args = ['-i', inputName, '-c', 'copy', '-movflags', '+faststart', outputName];
        } else {
          args = ['-i', inputName, '-c', 'copy', outputName];
        }
      } else {
        // Transcode requested
        const vCodec = options.videoCodec || 'copy';
        const aCodec = options.audioCodec || 'copy';
        args = ['-i', inputName, '-c:v', vCodec, '-c:a', aCodec];
        if (outputExt === 'mp4') {
          args.push('-movflags', '+faststart');
        }
        args.push(outputName);
      }

      let runSuccess = false;
      let lastErr: Error | null = null;

      try {
        await this.runCommand(args, options.onProgress, options.onLog, options.signal);
        runSuccess = true;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        // If stream-copy to MP4 failed due to incompatible audio (e.g. Opus in MP4),
        // fallback to -c:v copy -c:a aac (remuxes video lossless, only transcodes audio fast).
        if (isStreamCopy && outputExt === 'mp4') {
          console.warn('[FFmpegEngine] Stream copy failed. Retrying with video copy + AAC audio fallback...');
          args = [
            '-i',
            inputName,
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            '+faststart',
            outputName,
          ];
          try {
            await this.runCommand(args, options.onProgress, options.onLog, options.signal);
            runSuccess = true;
          } catch (retryErr) {
            throw retryErr;
          }
        } else {
          throw lastErr;
        }
      }

      const outputBytes = await this.readFile(outputName);
      const mime = getMimeType(outputExt);
      const blob = new Blob([outputBytes as any], { type: mime });
      const url = URL.createObjectURL(blob);
      const elapsedMs = Math.round(performance.now() - startTime);

      return {
        blob,
        url,
        fileName: `${baseName}.${outputExt}`,
        mimeType: mime,
        sizeBytes: blob.size,
        elapsedMs,
        isStreamCopy,
      };
    } finally {
      await this.deleteFile(inputName);
      await this.deleteFile(outputName);
    }
  }

  /**
   * Extracts audio track from video.
   * Default: lossless stream copy (-vn -c:a copy).
   */
  async extractAudio(options: ExtractAudioTaskOptions): Promise<FFmpegTaskResult> {
    await this.load();
    const startTime = performance.now();

    const targetFormat = (options.targetFormat || 'copy').toLowerCase() as AudioFormat;
    const isStreamCopy = options.streamCopy !== false && (targetFormat === 'copy' || targetFormat === 'native');

    const baseName = options.fileName?.replace(/\.[^/.]+$/, '') || 'media_audio';
    const inputExt = options.fileName?.split('.').pop() || 'mp4';
    const inputName = `input_${Date.now()}.${inputExt}`;

    let outputExt = 'm4a';
    if (targetFormat === 'mp3') outputExt = 'mp3';
    else if (targetFormat === 'wav') outputExt = 'wav';
    else if (targetFormat === 'flac') outputExt = 'flac';
    else if (targetFormat === 'opus' || targetFormat === 'ogg') outputExt = 'opus';
    else if (targetFormat === 'aac') outputExt = 'aac';
    else if (targetFormat === 'copy' || targetFormat === 'native') {
      // In copy mode, default to m4a or aac for MP4, or keep container standard
      outputExt = inputExt === 'webm' ? 'opus' : inputExt === 'mkv' ? 'mka' : 'm4a';
    }

    const outputName = `output_${Date.now()}.${outputExt}`;

    try {
      await this.writeFile(inputName, options.file);

      let args: string[] = [];
      if (isStreamCopy) {
        // Stream copy audio without re-encoding
        args = ['-i', inputName, '-vn', '-c:a', 'copy', outputName];
      } else {
        // Audio transcode
        const bitrate = `${options.bitrateKbps || 192}k`;
        if (outputExt === 'mp3') {
          args = ['-i', inputName, '-vn', '-c:a', 'libmp3lame', '-b:a', bitrate, outputName];
        } else if (outputExt === 'wav') {
          args = ['-i', inputName, '-vn', '-c:a', 'pcm_s16le', outputName];
        } else if (outputExt === 'flac') {
          args = ['-i', inputName, '-vn', '-c:a', 'flac', outputName];
        } else if (outputExt === 'aac' || outputExt === 'm4a') {
          args = ['-i', inputName, '-vn', '-c:a', 'aac', '-b:a', bitrate, outputName];
        } else if (outputExt === 'opus') {
          args = ['-i', inputName, '-vn', '-c:a', 'libopus', '-b:a', bitrate, outputName];
        } else {
          args = ['-i', inputName, '-vn', outputName];
        }
      }

      try {
        await this.runCommand(args, options.onProgress, options.onLog, options.signal);
      } catch (err) {
        // Fallback for copy when container mismatch occurs: try aac or mp3
        if (isStreamCopy) {
          console.warn('[FFmpegEngine] Direct audio stream copy failed, falling back to AAC transcode...');
          outputExt = 'm4a';
          const fallbackOutput = `output_${Date.now()}.${outputExt}`;
          args = ['-i', inputName, '-vn', '-c:a', 'aac', '-b:a', '192k', fallbackOutput];
          await this.runCommand(args, options.onProgress, options.onLog, options.signal);
        } else {
          throw err;
        }
      }

      const outputBytes = await this.readFile(outputName);
      const mime = getMimeType(outputExt);
      const blob = new Blob([outputBytes as any], { type: mime });
      const url = URL.createObjectURL(blob);
      const elapsedMs = Math.round(performance.now() - startTime);

      return {
        blob,
        url,
        fileName: `${baseName}.${outputExt}`,
        mimeType: mime,
        sizeBytes: blob.size,
        elapsedMs,
        isStreamCopy,
      };
    } finally {
      await this.deleteFile(inputName);
      await this.deleteFile(outputName);
    }
  }

  /**
   * Merges separate video and audio tracks into a unified container.
   * Default: lossless stream copy (-c:v copy -c:a copy) takes 2–5 seconds.
   */
  async merge(options: MergeTaskOptions): Promise<FFmpegTaskResult> {
    await this.load();
    const startTime = performance.now();
    const isStreamCopy = options.streamCopy !== false;

    const baseName =
      options.videoFileName?.replace(/\.[^/.]+$/, '') || 'merged_media';
    const vExt = options.videoFileName?.split('.').pop() || 'mp4';
    const aExt = options.audioFileName?.split('.').pop() || 'm4a';

    const videoName = `video_${Date.now()}.${vExt}`;
    const audioName = `audio_${Date.now()}.${aExt}`;

    const outputContainer = (options.targetContainer || 'mp4').toLowerCase();
    const outputName = `output_${Date.now()}.${outputContainer}`;

    try {
      await this.writeFile(videoName, options.videoFile);
      await this.writeFile(audioName, options.audioFile);

      // Base stream-copy command
      let args: string[] = ['-i', videoName];

      if (options.audioDelayMs && options.audioDelayMs !== 0) {
        const delaySec = (options.audioDelayMs / 1000).toFixed(3);
        args.push('-itsoffset', delaySec);
      }

      args.push('-i', audioName, '-map', '0:v:0', '-map', '1:a:0');

      if (isStreamCopy) {
        args.push('-c:v', 'copy', '-c:a', 'copy', '-shortest');
      } else {
        args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest');
      }

      if (outputContainer === 'mp4') {
        args.push('-movflags', '+faststart');
      }

      args.push(outputName);

      try {
        await this.runCommand(args, options.onProgress, options.onLog, options.signal);
      } catch (err) {
        // Fallback: If audio format cannot be stream-copied into MP4 (e.g. Opus audio),
        // transcode only audio to AAC while keeping video 100% lossless copy.
        if (isStreamCopy && outputContainer === 'mp4') {
          console.warn('[FFmpegEngine] Direct merge stream-copy failed. Retrying with video copy + AAC audio fallback...');
          args = ['-i', videoName];
          if (options.audioDelayMs && options.audioDelayMs !== 0) {
            const delaySec = (options.audioDelayMs / 1000).toFixed(3);
            args.push('-itsoffset', delaySec);
          }
          args.push(
            '-i',
            audioName,
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
            outputName
          );
          await this.runCommand(args, options.onProgress, options.onLog, options.signal);
        } else {
          throw err;
        }
      }

      const outputBytes = await this.readFile(outputName);
      const mime = getMimeType(outputContainer);
      const blob = new Blob([outputBytes as any], { type: mime });
      const url = URL.createObjectURL(blob);
      const elapsedMs = Math.round(performance.now() - startTime);

      return {
        blob,
        url,
        fileName: `${baseName}.${outputContainer}`,
        mimeType: mime,
        sizeBytes: blob.size,
        elapsedMs,
        isStreamCopy,
      };
    } finally {
      await this.deleteFile(videoName);
      await this.deleteFile(audioName);
      await this.deleteFile(outputName);
    }
  }

  /**
   * Executes arbitrary FFmpeg arguments with input/output handling.
   */
  async exec(options: CustomExecTaskOptions): Promise<FFmpegTaskResult> {
    await this.load();
    const startTime = performance.now();

    try {
      for (const input of options.inputFiles) {
        await this.writeFile(input.name, input.data);
      }

      await this.runCommand(options.args, options.onProgress, options.onLog, options.signal);

      const outputBytes = await this.readFile(options.outputFileName);
      const ext = options.outputFileName.split('.').pop() || '';
      const mime = options.outputMimeType || getMimeType(ext);
      const blob = new Blob([outputBytes as any], { type: mime });
      const url = URL.createObjectURL(blob);
      const elapsedMs = Math.round(performance.now() - startTime);

      return {
        blob,
        url,
        fileName: options.outputFileName,
        mimeType: mime,
        sizeBytes: blob.size,
        elapsedMs,
        isStreamCopy: options.args.includes('copy'),
      };
    } finally {
      for (const input of options.inputFiles) {
        await this.deleteFile(input.name);
      }
      await this.deleteFile(options.outputFileName);
    }
  }

  /**
   * Internal runner attaching progress listeners and signal handlers.
   */
  private async runCommand(
    args: string[],
    onProgress?: (progress: FFmpegProgress) => void,
    onLog?: (message: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.ffmpeg) throw new Error('FFmpeg not initialized.');
    if (signal?.aborted) throw new DOMException('Operation aborted.', 'AbortError');

    const progressHandler = ({ progress, time }: { progress: number; time: number }) => {
      const ratio = Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress));
      const percent = Math.round(ratio * 100);
      onProgress?.({
        ratio,
        percent,
        timeSeconds: time / 1000000, // time in microseconds
      });
    };

    const logHandler = ({ message }: { message: string }) => {
      onLog?.(message);

      // Parse speed and time from stderr line (e.g. speed= 45.2x time=00:01:23.45)
      const speedMatch = message.match(/speed=\s*([\d.]+x)/i);
      const timeMatch = message.match(/time=\s*(\d{2}:\d{2}:\d{2}\.?\d*)/i);
      const fpsMatch = message.match(/fps=\s*([\d.]+)/i);

      if (timeMatch || speedMatch || fpsMatch) {
        const timeFormatted = timeMatch ? timeMatch[1] : undefined;
        const timeSeconds = timeFormatted ? parseTimeToSeconds(timeFormatted) : undefined;
        const speed = speedMatch ? speedMatch[1] : undefined;
        const fps = fpsMatch ? parseFloat(fpsMatch[1]) : undefined;

        onProgress?.({
          ratio: 0.5,
          percent: 50,
          timeFormatted,
          timeSeconds,
          speed,
          fps,
          message,
        });
      }
    };

    this.ffmpeg.on('progress', progressHandler);
    this.ffmpeg.on('log', logHandler);

    let abortListener: (() => void) | null = null;
    if (signal) {
      abortListener = () => {
        try {
          this.ffmpeg?.terminate();
          this.isLoaded = false;
        } catch {
          // ignore
        }
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      const ret = await this.ffmpeg.exec(args);
      if (ret !== 0) {
        throw new Error(`FFmpeg exited with non-zero status code: ${ret}`);
      }
    } finally {
      this.ffmpeg.off('progress', progressHandler);
      this.ffmpeg.off('log', logHandler);
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
    }
  }

  /**
   * Terminates FFmpeg instance and cleans up.
   */
  terminate(): void {
    if (this.ffmpeg) {
      try {
        this.ffmpeg.terminate();
      } catch {
        // ignore
      }
      this.ffmpeg = null;
      this.isLoaded = false;
      this.loadedFrom = null;
      this.activeFiles.clear();
    }
  }
}
