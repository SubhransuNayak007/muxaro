/**
 * MUXARO Warm yt-dlp Persistent Daemon Manager
 * apps/web/lib/pipeline/ytdlp-daemon.ts
 *
 * Pod 2 (Agent 04) High-Performance IPC Daemon Pool
 * 
 * Maintains a warm pool of long-lived Python yt-dlp processes communicating
 * via stdin/stdout newline-delimited JSON-RPC to eliminate the 400-900ms Python cold-boot
 * penalty per request.
 *
 * Features:
 * - Anchored on globalThis.__muxaroYtDlpDaemon to eliminate process leaks during Next.js HMR
 * - 25-second per-request timeout with automatic process recycle on hang
 * - Automatic respawn on crash/OOM with jittered backoff
 * - Seamless fallback to direct yt-dlp CLI spawn if Python daemon is unavailable
 * - Health telemetry (ping, active workers, queue depth, crash metrics)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Canonical types for daemon RPC
export interface YtDlpDaemonFormat {
  format_id?: string;
  format_note?: string;
  ext?: string;
  url?: string;
  manifest_url?: string;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  tbr?: number;
  vbr?: number;
  abr?: number;
  asr?: number;
  http_headers?: Record<string, string>;
}

export interface YtDlpDaemonVideoInfo {
  id: string;
  title: string;
  uploader?: string;
  uploader_url?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
  formats: YtDlpDaemonFormat[];
  is_live?: boolean;
}

export interface DaemonPoolStats {
  poolSize: number;
  readyWorkers: number;
  activeRequests: number;
  totalRequestsHandled: number;
  totalErrors: number;
  crashCount: number;
  isDaemonAvailable: boolean;
  pythonExecutable: string | null;
  daemonScriptPath: string | null;
}

interface JsonRpcRequest {
  id: string;
  method: 'extract' | 'ping';
  url?: string;
}

interface JsonRpcResponse {
  id?: string;
  status?: string;
  version?: string;
  result?: any;
  error?: string;
}

interface PendingRequest {
  id: string;
  method: string;
  url?: string;
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timeoutTimer: NodeJS.Timeout;
  startTime: number;
}

export interface DaemonExtractOptions {
  timeoutMs?: number;
  bypassDaemon?: boolean;
}

// Locate Python daemon script across workspace structures
export function resolveDaemonScriptPath(): string | null {
  const cwd = process.cwd();
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

  const searchLocations = [
    path.resolve(cwd, 'scripts/ytdlp_daemon.py'),
    path.resolve(cwd, '../../scripts/ytdlp_daemon.py'),
    path.resolve(currentDir, '../../../../scripts/ytdlp_daemon.py'),
    path.resolve(currentDir, '../../../scripts/ytdlp_daemon.py'),
    path.resolve(currentDir, '../../scripts/ytdlp_daemon.py'),
  ];

  for (const candidate of searchLocations) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Locate suitable Python runtime
export function resolvePythonCommand(): string {
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Single long-lived Worker Process managing IPC with ytdlp_daemon.py
 */
class YtDlpDaemonWorker {
  public readonly id: number;
  private process: ChildProcess | null = null;
  private scriptPath: string;
  private pythonCmd: string;
  private pendingRequests = new Map<string, PendingRequest>();
  private stdoutBuffer = '';
  private isTerminated = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private isReady = false;
  public crashCount = 0;
  private lastCrashTimestamp = 0;
  private respawnTimer: NodeJS.Timeout | null = null;

  constructor(id: number, scriptPath: string, pythonCmd: string) {
    this.id = id;
    this.scriptPath = scriptPath;
    this.pythonCmd = pythonCmd;
    this.spawnProcess();
  }

  public get pendingCount(): number {
    return this.pendingRequests.size;
  }

  public get isAvailable(): boolean {
    return this.isReady && !this.isTerminated && this.process !== null;
  }

  public async waitUntilReady(timeoutMs = 8000): Promise<void> {
    if (this.isReady) return;
    if (!this.readyPromise) {
      throw new Error(`Worker #${this.id} is not initialized`);
    }

    const timer = new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`Worker #${this.id} ready handshake timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      t.unref?.();
    });

    await Promise.race([this.readyPromise, timer]);
  }

  private spawnProcess(): void {
    if (this.isTerminated) return;

    this.isReady = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    try {
      this.process = spawn(this.pythonCmd, [this.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      });
    } catch (spawnError: any) {
      this.isReady = false;
      this.readyReject?.(spawnError);
      return;
    }

    const child = this.process;

    child.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8');
      const lines = this.stdoutBuffer.split(/\r?\n/);
      this.stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this.handleIncomingLine(trimmed);
        }
      }
    });

    child.stderr?.on('data', (_chunk: Buffer) => {
      // Drain stderr to prevent pipe backpressure deadlock
    });

    child.on('error', (err) => {
      this.handleProcessDeath(err);
    });

    child.on('close', (code, signal) => {
      const exitReason = `Exit code ${code}${signal ? `, signal ${signal}` : ''}`;
      this.handleProcessDeath(new Error(`Worker #${this.id} exited: ${exitReason}`));
    });
  }

  private handleIncomingLine(line: string): void {
    try {
      const msg: JsonRpcResponse = JSON.parse(line);

      // Startup banner handshake: {"status": "ready", "version": "..."}
      if (msg.status === 'ready') {
        this.isReady = true;
        this.readyResolve?.();
        return;
      }

      // JSON-RPC Request Response matching
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const pending = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timeoutTimer);

        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
    } catch {
      // Ignore malformed non-JSON lines
    }
  }

  public async execute(method: 'extract' | 'ping', url?: string, timeoutMs = 25000): Promise<any> {
    if (this.isTerminated) {
      throw new Error(`Worker #${this.id} has been permanently terminated`);
    }

    await this.waitUntilReady();

    if (!this.process || !this.process.stdin || this.process.stdin.destroyed) {
      throw new Error(`Worker #${this.id} process stdin is unavailable`);
    }

    const reqId = `rpc_${this.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload: JsonRpcRequest = { id: reqId, method, ...(url ? { url } : {}) };

    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          // Process likely hung or blocked on network/GIL; force cycle worker
          this.recycle(`Extraction timed out after ${timeoutMs}ms for ${url || 'method:' + method}`);
          reject(new Error(`yt-dlp daemon request timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      timeoutTimer.unref?.();

      this.pendingRequests.set(reqId, {
        id: reqId,
        method,
        url,
        resolve,
        reject,
        timeoutTimer,
        startTime: Date.now(),
      });

      try {
        const line = JSON.stringify(payload) + '\n';
        this.process!.stdin!.write(line, 'utf8');
      } catch (writeErr: any) {
        clearTimeout(timeoutTimer);
        this.pendingRequests.delete(reqId);
        reject(new Error(`Failed to write to yt-dlp daemon stdin: ${writeErr.message}`));
      }
    });
  }

  private handleProcessDeath(err: Error): void {
    this.isReady = false;
    const now = Date.now();

    // Reset crash count if older than 30 seconds
    if (now - this.lastCrashTimestamp > 30000) {
      this.crashCount = 0;
    }
    this.crashCount++;
    this.lastCrashTimestamp = now;

    // Fail all in-flight requests assigned to this worker
    const currentPending = Array.from(this.pendingRequests.values());
    this.pendingRequests.clear();
    for (const req of currentPending) {
      clearTimeout(req.timeoutTimer);
      req.reject(new Error(`yt-dlp daemon worker crashed: ${err.message}`));
    }

    if (this.readyReject) {
      this.readyReject(err);
      this.readyReject = null;
    }

    if (this.process) {
      try {
        this.process.removeAllListeners();
        this.process.kill('SIGKILL');
      } catch {}
      this.process = null;
    }

    // Automatic Respawn on Crash/OOM with bounded backoff
    if (!this.isTerminated) {
      const backoffMs = Math.min(1000 * Math.pow(1.5, Math.min(this.crashCount, 5)), 8000);
      if (this.respawnTimer) clearTimeout(this.respawnTimer);
      this.respawnTimer = setTimeout(() => {
        this.spawnProcess();
      }, backoffMs);
      this.respawnTimer.unref?.();
    }
  }

  public recycle(reason: string): void {
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
        setTimeout(() => {
          if (this.process) {
            try { this.process.kill('SIGKILL'); } catch {}
          }
        }, 1500).unref?.();
      } catch {}
    }
    this.handleProcessDeath(new Error(`Worker recycled: ${reason}`));
  }

  public terminate(): void {
    this.isTerminated = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    if (this.process) {
      try {
        this.process.removeAllListeners();
        this.process.kill('SIGKILL');
      } catch {}
      this.process = null;
    }
    Array.from(this.pendingRequests.values()).forEach((req) => {
      clearTimeout(req.timeoutTimer);
      req.reject(new Error('Worker terminated'));
    });
    this.pendingRequests.clear();
  }
}

/**
 * Persistent Worker Pool anchored on globalThis.__muxaroYtDlpDaemon
 */
export class YtDlpDaemonPool {
  private workers: YtDlpDaemonWorker[] = [];
  private poolSize = 2;
  private scriptPath: string | null = null;
  private pythonCmd: string = 'python';
  private totalRequests = 0;
  private totalErrors = 0;
  private isAvailable = false;

  constructor() {
    this.scriptPath = resolveDaemonScriptPath();
    this.pythonCmd = resolvePythonCommand();

    if (this.scriptPath) {
      this.isAvailable = true;
      for (let i = 0; i < this.poolSize; i++) {
        this.workers.push(new YtDlpDaemonWorker(i + 1, this.scriptPath, this.pythonCmd));
      }
    }
  }

  public getStats(): DaemonPoolStats {
    const readyWorkers = this.workers.filter((w) => w.isAvailable).length;
    const activeRequests = this.workers.reduce((acc, w) => acc + w.pendingCount, 0);
    const crashCount = this.workers.reduce((acc, w) => acc + w.crashCount, 0);

    return {
      poolSize: this.workers.length,
      readyWorkers,
      activeRequests,
      totalRequestsHandled: this.totalRequests,
      totalErrors: this.totalErrors,
      crashCount,
      isDaemonAvailable: this.isAvailable && readyWorkers > 0,
      pythonExecutable: this.pythonCmd,
      daemonScriptPath: this.scriptPath,
    };
  }

  private pickLeastBusyWorker(): YtDlpDaemonWorker | null {
    const readyWorkers = this.workers.filter((w) => w.isAvailable);
    if (readyWorkers.length === 0) return null;

    return readyWorkers.reduce((min, curr) => 
      curr.pendingCount < min.pendingCount ? curr : min
    );
  }

  public async ping(timeoutMs = 5000): Promise<boolean> {
    if (!this.isAvailable || this.workers.length === 0) return false;
    try {
      const worker = this.pickLeastBusyWorker() || this.workers[0];
      const res = await worker.execute('ping', undefined, timeoutMs);
      return res?.status === 'pong';
    } catch {
      return false;
    }
  }

  public async extract(url: string, options: DaemonExtractOptions = {}): Promise<YtDlpDaemonVideoInfo> {
    const timeoutMs = options.timeoutMs ?? 35000;
    this.totalRequests++;

    if (!this.isAvailable || this.workers.length === 0) {
      this.totalErrors++;
      throw new Error('yt-dlp persistent daemon script not found or unavailable');
    }

    let worker = this.pickLeastBusyWorker();
    if (!worker) {
      // Wait briefly for any worker to become available
      await Promise.race(this.workers.map((w) => w.waitUntilReady(4000).catch(() => {})));
      worker = this.pickLeastBusyWorker();
    }

    if (!worker) {
      this.totalErrors++;
      throw new Error('No yt-dlp daemon workers are currently ready');
    }

    try {
      const result = await worker.execute('extract', url, timeoutMs);
      return result as YtDlpDaemonVideoInfo;
    } catch (err: any) {
      this.totalErrors++;
      throw err;
    }
  }

  public terminate(): void {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
  }
}

// Global anchor prevents Next.js HMR from spawning redundant process trees
declare global {
  // eslint-disable-next-line no-var
  var __muxaroYtDlpDaemon: YtDlpDaemonPool | undefined;
}

export function getYtDlpDaemonPool(): YtDlpDaemonPool {
  if (!globalThis.__muxaroYtDlpDaemon) {
    globalThis.__muxaroYtDlpDaemon = new YtDlpDaemonPool();

    // Register clean process shutdown hooks
    const cleanup = () => {
      try {
        globalThis.__muxaroYtDlpDaemon?.terminate();
      } catch {}
    };

    process.once('beforeExit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  return globalThis.__muxaroYtDlpDaemon;
}

/**
 * Graceful fallback to direct yt-dlp CLI spawn
 */
export async function spawnDirectYtDlpCli(url: string, timeoutMs = 25000): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json',
      '--force-ipv4',
      '--no-warnings',
      '--no-playlist',
      '--skip-download',
      '--socket-timeout', '18',
      url,
    ];

    const child = spawn('yt-dlp', args, {
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    let stdoutData = '';
    let stderrData = '';

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Direct yt-dlp CLI execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Direct yt-dlp CLI spawn failed: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdoutData.trim()) {
        try {
          const parsed = JSON.parse(stdoutData.trim());
          resolve(parsed);
        } catch (e: any) {
          reject(new Error(`Failed to parse direct yt-dlp JSON: ${e.message}`));
        }
      } else {
        const errMessage = stderrData.trim() || `yt-dlp CLI exited with code ${code}`;
        reject(new Error(errMessage));
      }
    });
  });
}

/**
 * Universal Extraction Entry Point:
 * Attempts warm daemon extraction first; falls back seamlessly to direct CLI spawn.
 */
export async function extractWithDaemonOrFallback(
  url: string,
  options: DaemonExtractOptions = {}
): Promise<any> {
  const timeoutMs = options.timeoutMs ?? 25000;

  if (!options.bypassDaemon) {
    try {
      const daemon = getYtDlpDaemonPool();
      return await daemon.extract(url, { timeoutMs });
    } catch {
      // Daemon failure or cold start timeout; fall through to direct CLI spawn
    }
  }

  // Graceful fallback to direct yt-dlp CLI spawn
  return await spawnDirectYtDlpCli(url, timeoutMs);
}
