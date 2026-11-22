/**
 * MUXARO Smart Scratch Allocator
 * apps/web/lib/pipeline/scratch.ts
 *
 * Intelligently routes temporary processing files between ultra-fast Linux tmpfs (/dev/shm)
 * and disk-backed scratch space based on free RAM thresholds and operating system.
 *
 * Rules:
 * - On Linux: inspect /dev/shm via fs.promises.statfs. If free RAM >= (2.5 * estimatedSize + 512MB),
 *   route to /dev/shm/muxaro/<jobId> (zero-disk RAM speed, zero NVMe write wear).
 * - On Windows / macOS / low-RAM Linux: route cleanly to process.env.MUXARO_SCRATCH_DIR ||
 *   path.join(os.tmpdir(), 'muxaro-scratch', jobId).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DiskIoMode } from './types.ts';

// ---------------------------------------------------------------------------
// Constants & Configuration
// ---------------------------------------------------------------------------

const LINUX_TMPFS_ROOT = '/dev/shm';
const SAFETY_MARGIN_BYTES = 512 * 1024 * 1024; // 512 MB reserved RAM margin
const RAM_MULTIPLIER = 2.5; // Scratch requires 2.5x estimated size for .part files + muxed out
const DEFAULT_ESTIMATED_SIZE = 250 * 1024 * 1024; // 250 MB default if unknown

export interface ScratchOptions {
  jobId: string;
  estimatedSizeBytes?: number;
  customScratchBase?: string;
}

export interface TmpfsInspection {
  available: boolean;
  freeBytes: number;
  totalBytes: number;
  requiredBytes: number;
  eligible: boolean;
  reason: string;
}

export interface ScratchDirectory {
  jobId: string;
  dirPath: string;
  isTmpfs: boolean;
  diskIoMode: DiskIoMode;
  getFilePath: (filename: string) => string;
  cleanup: () => Promise<void>;
  removeFile: (filenameOrPath: string) => Promise<void>;
  getFileSize: (filenameOrPath: string) => Promise<number>;
  fileExists: (filenameOrPath: string) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// RAM & Filesystem Inspection
// ---------------------------------------------------------------------------

/**
 * Inspects Linux /dev/shm tmpfs capacity against job requirements.
 */
export async function inspectTmpfsEligibility(
  estimatedSizeBytes?: number
): Promise<TmpfsInspection> {
  const estimated = estimatedSizeBytes && estimatedSizeBytes > 0 ? estimatedSizeBytes : DEFAULT_ESTIMATED_SIZE;
  const requiredBytes = Math.ceil(estimated * RAM_MULTIPLIER + SAFETY_MARGIN_BYTES);

  // Non-Linux OS check
  if (process.platform !== 'linux') {
    return {
      available: false,
      freeBytes: 0,
      totalBytes: 0,
      requiredBytes,
      eligible: false,
      reason: `Platform is ${process.platform}; /dev/shm tmpfs is only supported natively on Linux.`,
    };
  }

  // Check if /dev/shm exists and is accessible
  try {
    const stats = await fs.promises.statfs(LINUX_TMPFS_ROOT);
    const bsize = Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * bsize;
    const totalBytes = Number(stats.blocks) * bsize;

    const eligible = freeBytes >= requiredBytes;
    const reason = eligible
      ? `Eligible: /dev/shm has ${(freeBytes / 1024 / 1024).toFixed(1)} MB free (required: ${(requiredBytes / 1024 / 1024).toFixed(1)} MB)`
      : `Insufficient tmpfs: /dev/shm has ${(freeBytes / 1024 / 1024).toFixed(1)} MB free, but job requires ${(requiredBytes / 1024 / 1024).toFixed(1)} MB`;

    return {
      available: true,
      freeBytes,
      totalBytes,
      requiredBytes,
      eligible,
      reason,
    };
  } catch (err: any) {
    return {
      available: false,
      freeBytes: 0,
      totalBytes: 0,
      requiredBytes,
      eligible: false,
      reason: `/dev/shm statfs failed: ${err?.message || String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Scratch Allocator
// ---------------------------------------------------------------------------

/**
 * Allocates and initializes an isolated scratch workspace for a pipeline job.
 */
export async function allocateScratch(options: ScratchOptions): Promise<ScratchDirectory> {
  const { jobId, estimatedSizeBytes, customScratchBase } = options;

  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Valid jobId is required to allocate scratch space');
  }

  // Sanitize jobId to prevent directory traversal
  const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');

  const tmpfsInspection = await inspectTmpfsEligibility(estimatedSizeBytes);
  let targetDirPath: string;
  let isTmpfs = false;
  let diskIoMode: DiskIoMode = 'scratch';

  if (tmpfsInspection.eligible && !customScratchBase) {
    targetDirPath = path.join(LINUX_TMPFS_ROOT, 'muxaro', safeJobId);
    isTmpfs = true;
    diskIoMode = 'tmpfs';
  } else {
    const baseDir =
      customScratchBase ||
      process.env.MUXARO_SCRATCH_DIR ||
      path.join(os.tmpdir(), 'muxaro-scratch');
    targetDirPath = path.join(baseDir, safeJobId);
    isTmpfs = false;
    diskIoMode = 'scratch';
  }

  // Ensure directory exists
  await fs.promises.mkdir(targetDirPath, { recursive: true });

  const getFilePath = (filename: string): string => {
    // Prevent directory traversal inside scratch dir
    const safeFilename = path.basename(filename);
    return path.join(targetDirPath, safeFilename);
  };

  const removeFile = async (filenameOrPath: string): Promise<void> => {
    const fullPath = path.isAbsolute(filenameOrPath)
      ? filenameOrPath
      : getFilePath(filenameOrPath);
    try {
      await fs.promises.unlink(fullPath);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[Scratch] Warning: failed to unlink ${fullPath}:`, err?.message || err);
      }
    }
  };

  const getFileSize = async (filenameOrPath: string): Promise<number> => {
    const fullPath = path.isAbsolute(filenameOrPath)
      ? filenameOrPath
      : getFilePath(filenameOrPath);
    try {
      const stat = await fs.promises.stat(fullPath);
      return stat.size;
    } catch {
      return 0;
    }
  };

  const fileExists = async (filenameOrPath: string): Promise<boolean> => {
    const fullPath = path.isAbsolute(filenameOrPath)
      ? filenameOrPath
      : getFilePath(filenameOrPath);
    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  };

  const cleanup = async (): Promise<void> => {
    try {
      await fs.promises.rm(targetDirPath, { recursive: true, force: true });
    } catch (err: any) {
      console.warn(`[Scratch] Warning: failed to remove dir ${targetDirPath}:`, err?.message || err);
    }
  };

  return {
    jobId: safeJobId,
    dirPath: targetDirPath,
    isTmpfs,
    diskIoMode,
    getFilePath,
    cleanup,
    removeFile,
    getFileSize,
    fileExists,
  };
}

// ---------------------------------------------------------------------------
// Maintenance & Sweep Utilities
// ---------------------------------------------------------------------------

/**
 * Scans scratch directories and removes orphaned workspaces older than maxAgeMs.
 * Defaults to 1 hour (3600000 ms).
 */
export async function cleanupStaleScratchDirs(maxAgeMs = 3600000): Promise<number> {
  let cleanedCount = 0;
  const now = Date.now();
  const rootsToScan: string[] = [];

  if (process.platform === 'linux') {
    rootsToScan.push(path.join(LINUX_TMPFS_ROOT, 'muxaro'));
  }
  const diskBase = process.env.MUXARO_SCRATCH_DIR || path.join(os.tmpdir(), 'muxaro-scratch');
  rootsToScan.push(diskBase);

  for (const root of rootsToScan) {
    try {
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const entryPath = path.join(root, entry.name);
          try {
            const stats = await fs.promises.stat(entryPath);
            if (now - stats.mtimeMs > maxAgeMs) {
              await fs.promises.rm(entryPath, { recursive: true, force: true });
              cleanedCount++;
            }
          } catch {
            // Ignore individual stat/rm race condition errors
          }
        }
      }
    } catch {
      // Root might not exist yet, ignore
    }
  }

  return cleanedCount;
}
