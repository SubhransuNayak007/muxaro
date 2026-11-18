/**
 * MUXARO Media Processing Engine - Bounded Scratch Disk Manager
 * Prevents disk exhaustion via quota bounds, workspace isolation, and automated TTL cleanup.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProcessSanitizer } from '../process/sanitizer.js';

export interface ScratchDiskConfig {
  baseDirectory?: string;
  maxSizeBytes?: number; // Default 50 GB
  retentionTtlMs?: number; // Default 60 minutes for stale artifacts
}

export interface DiskUsageStats {
  baseDirectory: string;
  usedBytes: number;
  maxSizeBytes: number;
  percentUsed: number;
  activeWorkspacesCount: number;
}

export class ScratchDiskManager {
  private baseDir: string;
  private maxBytes: number;
  private retentionMs: number;
  private activeWorkspaces: Set<string> = new Set();

  constructor(config: ScratchDiskConfig = {}) {
    this.baseDir = path.resolve(
      config.baseDirectory ||
      process.env.SCRATCH_DIR ||
      path.join(os.tmpdir(), 'muxaro-scratch')
    );
    this.maxBytes = config.maxSizeBytes || 50 * 1024 * 1024 * 1024; // 50 GB
    this.retentionMs = config.retentionTtlMs || 60 * 60 * 1000; // 1 hour

    // Ensure base directory exists
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Returns base scratch directory path.
   */
  public getBaseDirectory(): string {
    return this.baseDir;
  }

  /**
   * Creates an isolated workspace directory for a specific job.
   */
  public createJobWorkspace(jobId: string): string {
    const safeJobId = ProcessSanitizer.sanitizeFilename(jobId, `job_${Date.now()}`);
    const workspacePath = path.join(this.baseDir, safeJobId);

    // Check bounds before creating
    this.enforceQuota();

    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    this.activeWorkspaces.add(safeJobId);
    return workspacePath;
  }

  /**
   * Deletes a job workspace and all contents safely.
   */
  public async cleanupJobWorkspace(jobId: string): Promise<void> {
    const safeJobId = ProcessSanitizer.sanitizeFilename(jobId);
    const workspacePath = path.join(this.baseDir, safeJobId);

    this.activeWorkspaces.delete(safeJobId);

    if (fs.existsSync(workspacePath)) {
      try {
        await fs.promises.rm(workspacePath, { recursive: true, force: true });
      } catch (err) {
        // Log warning but don't crash
        console.warn(`[ScratchDiskManager] Failed to remove workspace ${workspacePath}:`, err);
      }
    }
  }

  /**
   * Calculates current byte usage of the scratch directory.
   */
  public calculateCurrentUsageBytes(): number {
    if (!fs.existsSync(this.baseDir)) return 0;
    return this.calculateDirSize(this.baseDir);
  }

  /**
   * Returns disk usage metrics.
   */
  public getUsageStats(): DiskUsageStats {
    const usedBytes = this.calculateCurrentUsageBytes();
    const percentUsed = this.maxBytes > 0 ? Math.round((usedBytes / this.maxBytes) * 1000) / 10 : 0;

    return {
      baseDirectory: this.baseDir,
      usedBytes,
      maxSizeBytes: this.maxBytes,
      percentUsed,
      activeWorkspacesCount: this.activeWorkspaces.size
    };
  }

  /**
   * Checks if scratch disk is within safety limits. Throws error if quota is exceeded.
   */
  public enforceQuota(): void {
    const used = this.calculateCurrentUsageBytes();
    if (used >= this.maxBytes) {
      // Attempt garbage collection first
      this.reapStaleWorkspaces();
      const updatedUsed = this.calculateCurrentUsageBytes();
      if (updatedUsed >= this.maxBytes) {
        throw new Error(
          `Scratch disk quota exceeded: ${(updatedUsed / (1024 * 1024)).toFixed(2)} MB used out of ${(this.maxBytes / (1024 * 1024)).toFixed(2)} MB allowed.`
        );
      }
    }
  }

  /**
   * Reaps any workspaces or temp files older than retention TTL.
   */
  public reapStaleWorkspaces(): { reapedCount: number; freedBytes: number } {
    if (!fs.existsSync(this.baseDir)) {
      return { reapedCount: 0, freedBytes: 0 };
    }

    const now = Date.now();
    let reapedCount = 0;
    let freedBytes = 0;

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(this.baseDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        const ageMs = now - stat.mtimeMs;

        if (ageMs > this.retentionMs) {
          const itemSize = entry.isDirectory() ? this.calculateDirSize(fullPath) : stat.size;
          if (entry.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
          this.activeWorkspaces.delete(entry.name);
          reapedCount++;
          freedBytes += itemSize;
        }
      } catch {
        // Skip busy or locked files
      }
    }

    return { reapedCount, freedBytes };
  }

  private calculateDirSize(dirPath: string): number {
    let size = 0;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        try {
          if (entry.isDirectory()) {
            size += this.calculateDirSize(fullPath);
          } else if (entry.isFile()) {
            const stat = fs.statSync(fullPath);
            size += stat.size;
          }
        } catch {
          // ignore inaccessible entries
        }
      }
    } catch {
      // directory might have been deleted concurrently
    }
    return size;
  }
}
