'use client';

/**
 * Unified Native Bridge for MUXARO Web, Windows Desktop (.exe), and Android Mobile (.apk).
 * Allows PDF tools, Video/Audio studio tools, Camera Scanner, Google Drive import,
 * and local extractors to work 100% locally on device.
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
  captureScreenPng?: () => Promise<{ ok: boolean; bytes?: Uint8Array; error?: string }>;
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

/**
 * Returns true ONLY inside the standalone Windows .exe or Android .apk native apps.
 * Web browsers always return false cleanly.
 */
export function isNativeAppRuntime(): boolean {
  return isDesktopApp() || isCapacitorApp();
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

function base64ToUint8(b64: string): Uint8Array {
  const cleaned = b64.includes(',') ? b64.split(',').pop() || '' : b64;
  const bin = atob(cleaned);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * Extracts a direct download URL from Google Drive / Docs / Slides / Sheets links.
 */
export function resolveGoogleDriveDownloadUrl(input: string): {
  isDrive: boolean;
  fileId: string | null;
  downloadUrl: string;
  fallbackName: string;
} {
  const trimmed = input.trim();
  const docMatch = trimmed.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/i);
  if (docMatch) {
    const kind = docMatch[1].toLowerCase();
    const id = docMatch[2];
    const ext = kind === 'spreadsheets' ? 'xlsx' : kind === 'presentation' ? 'pdf' : 'pdf';
    const format = kind === 'spreadsheets' ? 'xlsx' : 'pdf';
    return {
      isDrive: true,
      fileId: id,
      downloadUrl: `https://docs.google.com/${kind}/d/${id}/export?format=${format}`,
      fallbackName: `drive-${kind}-${id.slice(0, 6)}.${ext}`,
    };
  }

  const driveMatch =
    trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i) ||
    trimmed.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([a-zA-Z0-9_-]+)/i) ||
    trimmed.match(/^[a-zA-Z0-9_-]{20,60}$/);

  if (driveMatch) {
    const id = driveMatch[1] || trimmed;
    return {
      isDrive: true,
      fileId: id,
      downloadUrl: `https://drive.google.com/uc?export=download&confirm=t&id=${encodeURIComponent(id)}`,
      fallbackName: `google-drive-${id.slice(0, 8)}`,
    };
  }

  return {
    isDrive: false,
    fileId: null,
    downloadUrl: trimmed,
    fallbackName: 'imported-file',
  };
}

/**
 * Captures the primary Windows desktop display into a PNG File (PDF24-style Screen Capture -> PDF).
 */
export async function captureDesktopScreenFile(): Promise<File | null> {
  if (!isDesktopApp() || !window.muxaroDesktop?.captureScreenPng) return null;
  const res = await window.muxaroDesktop.captureScreenPng();
  if (!res.ok || !res.bytes) return null;
  const ab = res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.byteLength) as ArrayBuffer;
  return new File([ab], `screen-capture-${Date.now()}.png`, {
    type: 'image/png',
    lastModified: Date.now(),
  });
}

/**
 * Downloads any Google Drive link or direct HTTPS file into a local browser File object.
 * Uses local Electron Node fetch (.exe) or Capacitor native HTTP (.apk) to bypass CORS cleanly.
 */
export async function fetchRemoteUrlToFile(
  rawUrl: string,
  accessToken?: string
): Promise<File> {
  const { downloadUrl, fallbackName, fileId, isDrive } = resolveGoogleDriveDownloadUrl(rawUrl);
  const parsed = new URL(downloadUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP/HTTPS links are supported.');
  }

  // Authenticated Google Drive API v3 download when OAuth access token is supplied
  const finalFetchUrl =
    isDrive && fileId && accessToken
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
      : downloadUrl;

  if (isDesktopApp()) {
    const res = await fetch('/api/v1/native/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: finalFetchUrl,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error?.message || `Import failed (${res.status}). Ensure Drive link is shared.`);
    }
    const headerName = res.headers.get('x-muxaro-filename');
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    const blob = await res.blob();
    const filename = decodeURIComponent(headerName || fallbackName);
    return new File([blob], filename, { type: mime, lastModified: Date.now() });
  }

  const capHttp = typeof window !== 'undefined' ? window.Capacitor?.Plugins?.CapacitorHttp : undefined;
  if (isCapacitorApp() && capHttp?.get) {
    const res = await capHttp.get({
      url: finalFetchUrl,
      responseType: 'blob',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
    if (!res || (res.status && res.status >= 400)) {
      throw new Error(`Google Drive / URL fetch failed (${res?.status || 'network'}). Make sure link is public or accessible.`);
    }
    const bytes = base64ToUint8(String(res.data || ''));
    const headers = res.headers || {};
    const ct = headers['content-type'] || headers['Content-Type'] || 'application/octet-stream';
    const disp = headers['content-disposition'] || headers['Content-Disposition'] || '';
    const m = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
    const filename = m?.[1] ? decodeURIComponent(m[1]) : fallbackName;
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new File([ab], filename, { type: ct, lastModified: Date.now() });
  }

  // Fallback standard fetch (works for CORS-enabled direct files or Drive API with token)
  const res = await fetch(finalFetchUrl, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  if (!res.ok) {
    throw new Error(`Could not fetch file (${res.status}).`);
  }
  const blob = await res.blob();
  return new File([blob], fallbackName, {
    type: blob.type || 'application/octet-stream',
    lastModified: Date.now(),
  });
}

/**
 * Captures a photo using native Android Camera (Capacitor Camera plugin) when on APK.
 * Returns null if cancelled or unavailable (caller falls back to web getUserMedia/file picker).
 */
export async function captureNativeCameraPhoto(): Promise<File | null> {
  if (!isCapacitorApp()) return null;
  const cam = window.Capacitor?.Plugins?.Camera;
  if (!cam?.getPhoto) return null;
  try {
    const photo = await cam.getPhoto({
      quality: 92,
      allowEditing: false,
      resultType: 'base64',
      source: 'CAMERA',
    });
    if (!photo?.base64String) return null;
    const bytes = base64ToUint8(photo.base64String);
    const fmt = String(photo.format || 'jpeg').toLowerCase();
    const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
    const ext = fmt === 'png' ? 'png' : 'jpg';
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new File([ab], `scan-${Date.now()}.${ext}`, { type: mime, lastModified: Date.now() });
  } catch {
    return null;
  }
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
