/**
 * MUXARO Media Processing Engine - Safe Subprocess Executor
 * Executes FFmpeg and FFprobe processes with bounded buffers, timeout guards, and real-time progress parsing.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { ProcessSanitizer } from './sanitizer.js';
import { ProgressCallback, ProgressEvent } from '../types/transcode.js';

export interface ExecutionOptions {
  timeoutMs?: number;
  totalDurationSeconds?: number;
  stage?: ProgressEvent['stage'];
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  maxOutputBufferBytes?: number;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
  durationMs: number;
}

export class FFmpegExecutor {
  public static readonly DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  public static readonly DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

  /**
   * Executes a command (ffmpeg or ffprobe) safely without a shell.
   */
  public static async execute(
    binary: string,
    args: string[],
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    // 1. Sanitize arguments
    ProcessSanitizer.validateArguments(args);

    const timeoutMs = options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
    const maxBuffer = options.maxOutputBufferBytes ?? this.DEFAULT_MAX_BUFFER;
    const stage = options.stage ?? 'transcoding';
    const totalDuration = options.totalDurationSeconds ?? 0;

    const startTime = Date.now();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;
    let killed = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let forceKillTimer: NodeJS.Timeout | null = null;

    return new Promise<ExecutionResult>((resolve, reject) => {
      let child: ChildProcess;

      try {
        child = spawn(binary, args, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (err) {
        return reject(new Error(`Failed to spawn binary "${binary}": ${(err as Error).message}`));
      }

      const terminateChild = (isTimeout: boolean) => {
        if (killed) return;
        killed = true;
        timedOut = isTimeout;

        try {
          if (child.stdin) {
            try {
              child.stdin.destroy();
            } catch {}
          }

          if (process.platform === 'win32' && child.pid) {
            // On Windows, child_process.kill may not terminate child subprocesses; spawn taskkill
            const tk = spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], {
              shell: false,
              windowsHide: true
            });
            tk.on('error', () => {
              try {
                child.kill();
              } catch {}
            });
          } else {
            child.kill('SIGTERM');
            forceKillTimer = setTimeout(() => {
              try {
                if (!child.killed) {
                  child.kill('SIGKILL');
                }
              } catch {
                // Ignore if already dead
              }
            }, 3000);
            forceKillTimer.unref?.();
          }
        } catch {
          // Process might already be dead
        }
      };

      // Set timeout guard
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          terminateChild(true);
        }, timeoutMs);
        timeoutTimer.unref?.();
      }

      // Handle external abort signal
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          terminateChild(false);
        });
      }

      child.stdin?.on('error', () => {});
      child.stdout?.on('error', () => {});
      child.stderr?.on('error', () => {});

      // Collect stdout & parse progress if progress pipe:1 is present
      let progressLineBuffer = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdoutBuffer = (stdoutBuffer + text).slice(-maxBuffer);

        // Parse key=value progress lines from FFmpeg -progress pipe:1
        progressLineBuffer += text;
        const lines = progressLineBuffer.split('\n');
        progressLineBuffer = lines.pop() ?? ''; // keep incomplete tail

        this.parseProgressLines(lines, stage, totalDuration, options.onProgress);
      });

      // Collect stderr
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderrBuffer = (stderrBuffer + text).slice(-maxBuffer);

        // Also fallback to parsing stderr progress lines if -progress pipe:1 was not used
        this.parseStderrProgress(text, stage, totalDuration, options.onProgress);
      });

      child.on('error', (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        reject(new Error(`Subprocess error in "${binary}": ${err.message}`));
      });

      child.on('close', (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);

        const durationMs = Date.now() - startTime;
        const exitCode = code ?? (killed ? -1 : 0);

        if (timedOut) {
          return reject(
            new Error(`Process "${binary}" timed out after ${timeoutMs}ms. Stderr: ${stderrBuffer.slice(-1000)}`)
          );
        }

        if (killed && options.signal?.aborted) {
          return reject(new Error(`Process "${binary}" was aborted.`));
        }

        resolve({
          exitCode,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          timedOut,
          killed,
          durationMs
        });
      });
    });
  }

  /**
   * Parses FFmpeg -progress pipe:1 stream key=value pairs.
   */
  private static parseProgressLines(
    lines: string[],
    stage: ProgressEvent['stage'],
    totalDuration: number,
    onProgress?: ProgressCallback
  ): void {
    if (!onProgress || lines.length === 0) return;

    let currentTimeSeconds = 0;
    let fps = 0;
    let speed = 1.0;
    let currentFrame = 0;
    let bitrateKbps = 0;
    let hasOutTime = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;

      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();

      if (key === 'out_time_us') {
        const us = parseInt(val, 10);
        if (!isNaN(us) && us > 0) {
          currentTimeSeconds = us / 1_000_000;
          hasOutTime = true;
        }
      } else if (key === 'fps') {
        const f = parseFloat(val);
        if (!isNaN(f)) fps = f;
      } else if (key === 'frame') {
        const fr = parseInt(val, 10);
        if (!isNaN(fr)) currentFrame = fr;
      } else if (key === 'speed') {
        const s = parseFloat(val.replace('x', ''));
        if (!isNaN(s)) speed = s;
      } else if (key === 'bitrate') {
        const br = parseFloat(val.replace('kbits/s', ''));
        if (!isNaN(br)) bitrateKbps = br;
      } else if (key === 'progress' && val === 'end') {
        onProgress({
          stage,
          percentage: 100,
          currentTimeSeconds: totalDuration,
          totalDurationSeconds: totalDuration,
          fps,
          speed,
          currentFrame,
          bitrateKbps
        });
        return;
      }
    }

    if (hasOutTime && totalDuration > 0) {
      const percentage = Math.min(100, Math.max(0, (currentTimeSeconds / totalDuration) * 100));
      const remainingSeconds = Math.max(0, totalDuration - currentTimeSeconds);
      const etaSeconds = speed > 0 ? Math.round(remainingSeconds / speed) : undefined;

      onProgress({
        stage,
        percentage: Math.round(percentage * 10) / 10,
        currentTimeSeconds: Math.round(currentTimeSeconds * 100) / 100,
        totalDurationSeconds: totalDuration,
        fps,
        speed,
        currentFrame,
        bitrateKbps,
        etaSeconds
      });
    }
  }

  /**
   * Fallback parser for standard FFmpeg stderr output (e.g. "time=00:01:23.45 bitrate= 1234.5kbits/s speed=1.5x").
   */
  private static parseStderrProgress(
    text: string,
    stage: ProgressEvent['stage'],
    totalDuration: number,
    onProgress?: ProgressCallback
  ): void {
    if (!onProgress || totalDuration <= 0) return;

    const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
    if (!timeMatch) return;

    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const seconds = parseFloat(timeMatch[3]);
    const currentTimeSeconds = hours * 3600 + minutes * 60 + seconds;

    let speed: number | undefined;
    const speedMatch = text.match(/speed=\s*([\d.]+)x/);
    if (speedMatch) {
      speed = parseFloat(speedMatch[1]);
    }

    let fps: number | undefined;
    const fpsMatch = text.match(/fps=\s*([\d.]+)/);
    if (fpsMatch) {
      fps = parseFloat(fpsMatch[1]);
    }

    const percentage = Math.min(100, Math.max(0, (currentTimeSeconds / totalDuration) * 100));
    const remainingSeconds = Math.max(0, totalDuration - currentTimeSeconds);
    const etaSeconds = speed && speed > 0 ? Math.round(remainingSeconds / speed) : undefined;

    onProgress({
      stage,
      percentage: Math.round(percentage * 10) / 10,
      currentTimeSeconds: Math.round(currentTimeSeconds * 100) / 100,
      totalDurationSeconds: totalDuration,
      fps,
      speed,
      etaSeconds
    });
  }
}
