/**
 * MUXARO Origin Private File System (OPFS) - Storage Management & Quota Governor
 * apps/web/lib/opfs/opfs-storage.ts
 *
 * Provides:
 * 1. Storage quota estimation and pre-flight validation (prevents mid-stream disk exhaustion).
 * 2. Directory structure management for isolated stream accumulation.
 * 3. Automatic garbage collection of orphaned or expired stream files.
 * 4. Cross-browser feature detection for OPFS and File System Access API.
 */

import { OPFSError } from './types.ts';
import type { StorageQuotaInfo } from './types.ts';

export const DEFAULT_OPFS_SUBDIRECTORY = 'muxaro_streams';

/**
 * Detects whether the Origin Private File System (OPFS) is supported in current context.
 * Supported across modern Chromium, Safari (iOS & macOS 15.2+), and Firefox (111+).
 */
export function isOPFSSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return false;
  }
  return typeof navigator.storage.getDirectory === 'function';
}

/**
 * Detects whether the File System Access API (showSaveFilePicker) is supported.
 * Supported in Chromium desktop (Chrome, Edge, Opera, Brave).
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showSaveFilePicker === 'function';
}

/**
 * Estimates storage quota allocated to this origin.
 * Returns total quota, used bytes, and available bytes.
 */
export async function getStorageQuota(): Promise<StorageQuotaInfo | null> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
    return null;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota ?? 0;
    const usage = estimate.usage ?? 0;
    const available = Math.max(0, quota - usage);
    const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;

    return {
      quota,
      usage,
      available,
      percentUsed,
      canFit: (requiredBytes: number) => quota === 0 || available >= requiredBytes,
    };
  } catch (err) {
    console.warn('[MUXARO] Failed to estimate storage quota:', err);
    return null;
  }
}

/**
 * Pre-flights storage requirements before starting an 8K/4K media download.
 * Validates that the device has sufficient disk space granted by the browser sandbox.
 */
export async function preflightStorageCheck(requiredBytes: number): Promise<{
  ok: boolean;
  availableBytes: number;
  quotaBytes: number;
  reason?: string;
}> {
  const quota = await getStorageQuota();
  if (!quota) {
    // Cannot inspect quota (e.g. older browser) - allow execution with caution
    return { ok: true, availableBytes: 0, quotaBytes: 0 };
  }

  // Add 10% safety margin for filesystem metadata and container packaging
  const requiredWithHeadroom = Math.ceil(requiredBytes * 1.1);

  if (quota.quota > 0 && quota.available < requiredWithHeadroom) {
    const availMB = Math.round(quota.available / 1024 / 1024);
    const reqMB = Math.round(requiredBytes / 1024 / 1024);
    return {
      ok: false,
      availableBytes: quota.available,
      quotaBytes: quota.quota,
      reason: `Insufficient browser disk quota: ${reqMB} MB required, but only ${availMB} MB available in OPFS sandbox. Free up disk space or clear browser data.`,
    };
  }

  return {
    ok: true,
    availableBytes: quota.available,
    quotaBytes: quota.quota,
  };
}

/**
 * Retrieves the designated directory handle within the Origin Private File System.
 */
export async function getStreamsDirectory(
  subDirectory: string = DEFAULT_OPFS_SUBDIRECTORY
): Promise<FileSystemDirectoryHandle> {
  if (!isOPFSSupported()) {
    throw new OPFSError('Origin Private File System (OPFS) is not supported in this browser', 'NOT_SUPPORTED');
  }

  const root = await navigator.storage.getDirectory();
  if (!subDirectory || subDirectory === '.') {
    return root;
  }
  return await root.getDirectoryHandle(subDirectory, { create: true });
}

export interface OPFSFileInfo {
  name: string;
  size: number;
  lastModified: number;
  type: string;
}

/**
 * Lists all stream files stored in the OPFS stream cache directory.
 */
export async function listOPFSFiles(
  subDirectory: string = DEFAULT_OPFS_SUBDIRECTORY
): Promise<OPFSFileInfo[]> {
  if (!isOPFSSupported()) return [];

  try {
    const dir = await getStreamsDirectory(subDirectory);
    const results: OPFSFileInfo[] = [];

    // Iterating entries via async iterator
    // @ts-expect-error FileSystemDirectoryHandle async iterable in modern web specs
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file') {
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          results.push({
            name,
            size: file.size,
            lastModified: file.lastModified,
            type: file.type,
          });
        } catch {
          // File might be locked or deleted during iteration
        }
      }
    }

    return results;
  } catch (err) {
    console.warn('[MUXARO] Failed to list OPFS directory entries:', err);
    return [];
  }
}

/**
 * Deletes a specific file from the OPFS stream directory.
 */
export async function deleteOPFSFile(
  fileName: string,
  subDirectory: string = DEFAULT_OPFS_SUBDIRECTORY
): Promise<boolean> {
  if (!isOPFSSupported()) return false;
  try {
    const dir = await getStreamsDirectory(subDirectory);
    await dir.removeEntry(fileName);
    return true;
  } catch (err) {
    // If not found, considered cleanly removed
    return false;
  }
}

/**
 * Garbage-collects orphaned temporary stream files older than maxAgeMs.
 * Default max age: 24 hours. Returns number of purged files.
 */
export async function cleanupOrphanedStreams(
  maxAgeMs: number = 24 * 60 * 60 * 1000,
  subDirectory: string = DEFAULT_OPFS_SUBDIRECTORY
): Promise<number> {
  if (!isOPFSSupported()) return 0;

  let purgedCount = 0;
  const now = Date.now();

  try {
    const files = await listOPFSFiles(subDirectory);
    const dir = await getStreamsDirectory(subDirectory);

    for (const file of files) {
      const ageMs = now - file.lastModified;
      if (ageMs > maxAgeMs) {
        try {
          await dir.removeEntry(file.name);
          purgedCount++;
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[MUXARO] OPFS garbage collection encountered an error:', err);
  }

  return purgedCount;
}

/**
 * Completely wipes all stream files inside the OPFS stream subdirectory.
 */
export async function clearAllOPFSStreams(
  subDirectory: string = DEFAULT_OPFS_SUBDIRECTORY
): Promise<void> {
  if (!isOPFSSupported()) return;

  try {
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(subDirectory, { recursive: true });
    } catch (_) {
      // Subdirectory might not exist yet
    }
  } catch (err) {
    console.warn('[MUXARO] Failed to clear OPFS streams directory:', err);
  }
}
