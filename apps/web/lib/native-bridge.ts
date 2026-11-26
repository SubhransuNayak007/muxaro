'use client';

/**
 * Unified Native Bridge for MUXARO Web, Windows Desktop (.exe), and Android Mobile (.apk).
 * Allows PDF tools, Video/Audio studio tools, and local extractors to work 100% locally on device.
 */

export interface DesktopLocalJobRequest {
  kind: 'probe' | 'download' | 'ffmpeg';
  url?: string;
  format?: string;
  quality?: string;
  args?: string[];
  inputPath?: string;
  outputName?: string;
}

export interface DesktopLocalJobResult {
  ok: boolean;
  title?: string;
  durationSec?: number;
  thumbnail?: string;
  formats?: Array<{
    formatId: string;
    ext: string;
    resolution: string;
    fps?: number;
    filesize?: number;
    hasVideo: boolean;
    hasAudio: boolean;
    note?: string;
  }>;
  outputPath?: string;
  fileUrl?: string;
  filename?: string;
  sizeBytes?: number;
  mimeType?: string;
  error?: string;
}

export interface MuxaroDesktopBridge {
  isDesktop: true;
  platform: string;
  version: string;
  localPort: number;
  hasLocalFfmpeg: () => Promise<boolean>;
  hasLocalYtdlp: () => Promise<boolean>;
  probeUrl: (url: string) => Promise<DesktopLocalJobResult>;
  downloadLocal: (opts: {
    url: string;
    formatId?: string;
    mode?: 'video' | 'audio' | 'compact';
    quality?: string;
  }) => Promise<DesktopLocalJobResult>;
  saveBlob: (opts: {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }) => Promise<{ ok: boolean; savedPath?: string; canceled?: boolean; error?: string }>;
  openDownloadsFolder: () => Promise<void>;
}

declare global {
  interface Window {
    muxaroDesktop?: MuxaroDesktopBridge;
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
      Plugins?: Record<string, any>;
    };
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && Boolean(window.muxaroDesktop?.isDesktop);
}

export function isCapacitorApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

export function getRuntimePlatform(): 'desktop-exe' | 'android-apk' | 'web' {
  if (isDesktopApp()) return 'desktop-exe';
  if (isCapacitorApp()) return 'android-apk';
  return 'web';
}

export async function triggerHapticTap(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const haptics = window.Capacitor?.Plugins?.Haptics;
    if (haptics?.impact) {
      await haptics.impact({ style: 'LIGHT' });
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(8);
    }
  } catch {
    // Ignore unsupported haptics
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Saves or shares an output Blob cleanly across Desktop EXE, Android APK, and Web browsers.
 */
export async function saveOrShareArtifact(
  blob: Blob,
  filename: string,
  title?: string
): Promise<{ ok: boolean; method: 'desktop' | 'capacitor' | 'web'; path?: string }> {
  const desktop = typeof window !== 'undefined' ? window.muxaroDesktop : undefined;
  if (desktop?.saveBlob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const res = await desktop.saveBlob({
      filename,
      mimeType: blob.type || 'application/octet-stream',
      bytes: buf,
    });
    if (res.ok) {
      return { ok: true, method: 'desktop', path: res.savedPath };
    }
    if (res.canceled) {
      return { ok: false, method: 'desktop' };
    }
  }

  const capPlugins = typeof window !== 'undefined' ? window.Capacitor?.Plugins : undefined;
  if (isCapacitorApp() && capPlugins?.Filesystem) {
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const base64Data = uint8ToBase64(buf);
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const written = await capPlugins.Filesystem.writeFile({
        path: `MUXARO/${safeName}`,
        data: base64Data,
        directory: 'CACHE',
        recursive: true,
      });
      if (capPlugins.Share?.share && written?.uri) {
        await capPlugins.Share.share({
          title: title || safeName,
          url: written.uri,
          dialogTitle: `Save or share ${safeName}`,
        });
      }
      return { ok: true, method: 'capacitor', path: written?.uri };
    } catch {
      // Fall back to standard browser blob download below
    }
  }

  // Standard Web / WebView Blob Download
  if (typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true, method: 'web' };
  }

  return { ok: false, method: 'web' };
}
