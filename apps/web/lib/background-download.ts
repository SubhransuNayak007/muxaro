export const AUTO_DOWNLOAD_STORAGE_KEY = 'muxaro-auto-download';

export interface BackgroundDownloadCapabilities {
  /** Browser exposes BackgroundFetchManager and Service Workers */
  supported: boolean;
  /** An active Service Worker registration with backgroundFetch is ready to accept fetches */
  ready: boolean;
  /** User or device enabled Data Saver / Save-Data mode */
  saveData: boolean;
  /** Plain-English explanation of current browser capability */
  note: string;
}

export interface BackgroundDownloadRequest {
  id: string;
  url: string;
  title: string;
  filename?: string;
  sizeBytes?: number;
}

export interface BackgroundDownloadResult {
  started: boolean;
  mode: 'background-fetch' | 'browser-download';
  message: string;
}

interface BackgroundFetchManagerLike {
  fetch(
    id: string,
    requests: Array<string | Request>,
    options?: {
      title?: string;
      downloadTotal?: number;
      icons?: Array<{ src: string; sizes?: string; type?: string }>;
    }
  ): Promise<unknown>;
}

interface ServiceWorkerRegistrationWithBgFetch extends ServiceWorkerRegistration {
  backgroundFetch?: BackgroundFetchManagerLike;
}

interface NavigatorConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

function getNavigatorConnection(): NavigatorConnectionLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { connection?: NavigatorConnectionLike }).connection;
}

export function isSaveDataEnabled(): boolean {
  const conn = getNavigatorConnection();
  return conn?.saveData === true;
}

/**
 * Opt-in auto-download preference stored in localStorage.
 * Default is strictly OFF (false) so browsers never trigger unexpected downloads.
 */
export function getAutoDownloadPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAutoDownloadPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTO_DOWNLOAD_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage errors in private/restricted contexts
  }
}

/**
 * Feature-detects Background Fetch API support and active Service Worker readiness.
 * Never fabricates support: `ready` is true only when an active registration exposes `backgroundFetch`.
 */
export async function detectBackgroundDownloadSupport(): Promise<BackgroundDownloadCapabilities> {
  const saveData = isSaveDataEnabled();
  const fallbackNote =
    'Processing continues safely on our servers even if you leave this page. Completed files stay available in My Downloads.';

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      supported: false,
      ready: false,
      saveData: false,
      note: fallbackNote,
    };
  }

  const hasApi =
    'BackgroundFetchManager' in window && 'serviceWorker' in navigator;

  if (!hasApi) {
    return {
      supported: false,
      ready: false,
      saveData,
      note: fallbackNote,
    };
  }

  try {
    const registration = (await navigator.serviceWorker.getRegistration()) as
      | ServiceWorkerRegistrationWithBgFetch
      | undefined;
    const isReady = Boolean(registration?.active && registration?.backgroundFetch);

    return {
      supported: true,
      ready: isReady,
      saveData,
      note: isReady
        ? 'Your browser supports background downloads, and completed files also stay available in My Downloads.'
        : fallbackNote,
    };
  } catch {
    return {
      supported: true,
      ready: false,
      saveData,
      note: fallbackNote,
    };
  }
}

/**
 * Progressive enhancement: uses Background Fetch API when an active Service Worker supports it,
 * otherwise cleanly signals that the standard browser download + My Downloads fallback should be used.
 */
export async function startBackgroundDownload(
  request: BackgroundDownloadRequest
): Promise<BackgroundDownloadResult> {
  const fallbackMessage =
    'Started a standard browser download. Your file also stays available in My Downloads.';

  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !('BackgroundFetchManager' in window) ||
    !('serviceWorker' in navigator)
  ) {
    return {
      started: false,
      mode: 'browser-download',
      message: fallbackMessage,
    };
  }

  try {
    const registration = (await navigator.serviceWorker.getRegistration()) as
      | ServiceWorkerRegistrationWithBgFetch
      | undefined;

    if (!registration?.active || !registration.backgroundFetch) {
      return {
        started: false,
        mode: 'browser-download',
        message: fallbackMessage,
      };
    }

    const fetchId = `muxaro-${request.id}-${Date.now()}`;
    await registration.backgroundFetch.fetch(fetchId, [request.url], {
      title: request.filename || request.title || 'MUXARO download',
      downloadTotal:
        typeof request.sizeBytes === 'number' && request.sizeBytes > 0
          ? request.sizeBytes
          : 0,
    });

    return {
      started: true,
      mode: 'background-fetch',
      message:
        'Downloading in the background. You can safely switch tabs or close this page.',
    };
  } catch {
    return {
      started: false,
      mode: 'browser-download',
      message: fallbackMessage,
    };
  }
}

/**
 * Maps internal error codes or technical exception messages into calm, everyday English.
 * Never exposes raw uppercase enum codes (like HTTP_416 or TRANSCODING_RESOURCE_LIMIT) on primary UI lines.
 */
export function mapFriendlyError(
  rawMessage?: string,
  errorCode?: string
): string {
  const combined = `${errorCode || ''} ${rawMessage || ''}`.trim();
  const upper = combined.toUpperCase();

  if (!combined) {
    return 'We could not finish processing this file. Please try again.';
  }

  if (upper.includes('416') || upper.includes('RANGE_NOT_SATISFIABLE')) {
    return 'This download could not be resumed. Please start a fresh download.';
  }
  if (
    upper.includes('TRANSCODING_RESOURCE_LIMIT') ||
    upper.includes('RESOURCE_LIMIT') ||
    upper.includes('OUT_OF_MEMORY') ||
    upper.includes('OOM')
  ) {
    return 'Our servers are currently busy handling large videos. Please try again in a moment or pick a smaller quality.';
  }
  if (upper.includes('SSRF') || upper.includes('PRIVATE_NETWORK') || upper.includes('FORBIDDEN_HOST')) {
    return 'That link points to a private or unsupported address. Please paste a public media link.';
  }
  if (upper.includes('QUOTA') || upper.includes('DAILY_LIMIT') || upper.includes('INSUFFICIENT_CREDITS')) {
    return 'You have reached your daily limit for now. Check Usage to see when your allowance resets.';
  }
  if (upper.includes('429') || upper.includes('RATE_LIMIT') || upper.includes('TOO MANY REQUESTS')) {
    return 'Too many requests in a short time. Wait a few seconds and try again.';
  }
  if (
    upper.includes('BOT') ||
    upper.includes('SIGN IN') ||
    upper.includes('LOGIN_REQUIRED') ||
    upper.includes('VERIFICATION') ||
    upper.includes('MUXARO DIRECT')
  ) {
    return 'YouTube requires verification for this stream on cloud servers. Use MUXARO Direct to download directly from your browser with zero limits.';
  }
  if (
    upper.includes('TIMEOUT') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('ECONNREFUSED') ||
    upper.includes('NETWORK') ||
    upper.includes('FETCH FAILED') ||
    upper.includes('NOT_RESOLVED') ||
    upper.includes('ENOTFOUND') ||
    upper.includes('OFFLINE')
  ) {
    return 'We had trouble reaching the server. Check your connection and try again.';
  }
  if (upper.includes('NOT_FOUND') || upper.includes('404') || upper.includes('UNAVAILABLE')) {
    return 'This media source could not be found or is no longer available.';
  }
  if (upper.includes('UNSUPPORTED') || upper.includes('INVALID_FORMAT') || upper.includes('CORRUPT')) {
    return 'This file format could not be read. Try a standard MP4, MOV, MKV, WebM, MP3, or WAV file.';
  }

  // Strip raw uppercase technical codes if they leaked into a sentence
  const cleaned = (rawMessage || '')
    .replace(/\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/g, '')
    .replace(/\bHTTP[_\s]?\d{3}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (cleaned.length >= 12 && !/^[a-z0-9_.:/-]+$/i.test(cleaned)) {
    return cleaned;
  }

  return 'We could not finish processing this file. Please try again.';
}

let isDirectBridgeVerified = false;

/**
 * Sends a ping message to trigger a handshake response from the MUXARO Direct companion userscript or bridge.
 */
export function pingMuxaroDirect(): void {
  if (typeof window === 'undefined') return;
  try {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const origin =
      window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : '*';
    window.postMessage(
      {
        type: 'MUXARO_DIRECT_PING',
        source: 'MUXARO_APP',
        timestamp: Date.now(),
        nonce,
      },
      origin
    );
  } catch {
    // Ignore postMessage transmission failures in sandboxed contexts
  }
}

// Proactive ping-pong detection and bridge verification setup on module load
if (typeof window !== 'undefined') {
  try {
    window.addEventListener('message', (e: MessageEvent) => {
      try {
        if (e.source !== window) return;
        if (e.origin && e.origin !== 'null' && e.origin !== window.location.origin) return;
        if (
          e.data &&
          typeof e.data === 'object' &&
          (e.data.type === 'MUXARO_DIRECT_PONG' ||
            e.data.type === 'MUXARO_DIRECT_READY' ||
            (e.data.source === 'MUXARO_BRIDGE' && e.data.type === 'PONG'))
        ) {
          isDirectBridgeVerified = true;
          try {
            sessionStorage.setItem('muxaro_direct_connected', 'true');
            if (typeof e.data.version === 'string') {
              sessionStorage.setItem('muxaro_direct_version', e.data.version);
            }
          } catch (_) {}
          window.dispatchEvent(
            new CustomEvent('muxaro:direct-ready', {
              detail: {
                version: typeof e.data.version === 'string' ? e.data.version : '1.2.0',
                active: true,
              },
            })
          );
        }
      } catch {
        // Safe guard against foreign origin or malformed objects
      }
    });

    window.addEventListener('muxaro:direct-ready', () => {
      isDirectBridgeVerified = true;
    });

    // Proactively ping userscript upon module load
    pingMuxaroDirect();
  } catch {
    // Browser environment initialization guard
  }
}

/**
 * Helper to initiate detection with ping-pong handshake and optional callback when active.
 * Returns a teardown cleanup function.
 */
export function initiateDirectDetection(onActive?: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let notified = false;
  const notify = () => {
    if (notified) return;
    notified = true;
    onActive?.();
  };

  // Immediate check if already detected or verified
  if (isMuxaroDirectActive()) {
    notify();
  }

  const handleMessage = (e: MessageEvent) => {
    try {
      if (e.source !== window) return;
      if (e.origin && e.origin !== 'null' && e.origin !== window.location.origin) return;
      if (
        e.data &&
        typeof e.data === 'object' &&
        (e.data.type === 'MUXARO_DIRECT_PONG' ||
          e.data.type === 'MUXARO_DIRECT_READY' ||
          (e.data.source === 'MUXARO_BRIDGE' && e.data.type === 'PONG'))
      ) {
        isDirectBridgeVerified = true;
        notify();
      }
    } catch {
      // Ignore
    }
  };

  const handleCustomEvent = () => {
    isDirectBridgeVerified = true;
    notify();
  };

  window.addEventListener('message', handleMessage);
  window.addEventListener('muxaro:direct-ready', handleCustomEvent);

  pingMuxaroDirect();

  return () => {
    window.removeEventListener('message', handleMessage);
    window.removeEventListener('muxaro:direct-ready', handleCustomEvent);
  };
}

/**
 * Detects whether the MUXARO Direct companion userscript or bridge is active in the current browser window.
 * Checks verified message-bridge state, session storage, and DOM attributes.
 */
export function isMuxaroDirectActive(): boolean {
  if (typeof window === 'undefined') return false;

  if (isDirectBridgeVerified) {
    return true;
  }

  try {
    if (sessionStorage.getItem('muxaro_direct_connected') === 'true') {
      isDirectBridgeVerified = true;
      return true;
    }
  } catch (_) {}

  if (typeof document !== 'undefined' && document.documentElement) {
    const el = document.documentElement;
    if (
      el.getAttribute('data-muxaro-direct') === 'active' ||
      el.dataset?.muxaroDirect === 'active'
    ) {
      isDirectBridgeVerified = true;
      return true;
    }
  }

  return false;
}

/**
 * Dispatches a client-side streaming download event to the MUXARO Direct bridge,
 * triggering direct residential downloading through the browser sandbox.
 * Dispatches both CustomEvent and window.postMessage for maximum sandbox compatibility.
 */
export function triggerMuxaroDirectDownload(streamUrl: string, filename?: string): boolean {
  if (typeof window === 'undefined' || !streamUrl || typeof streamUrl !== 'string') return false;
  const trimmedUrl = streamUrl.trim();
  const isHttp = /^https?:\/\//i.test(trimmedUrl);
  const isSameOriginBlob =
    trimmedUrl.startsWith('blob:') &&
    typeof window !== 'undefined' &&
    trimmedUrl.startsWith(`blob:${window.location.origin}/`);

  if (!isHttp && !isSameOriginBlob) {
    return false;
  }

  try {
    const safeFilename = (filename || 'media_download.mp4')
      .replace(/[\r\n\0]/g, '')
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\.\.+/g, '.')
      .trim() || 'media_download.mp4';

    const detail = {
      streamUrl: trimmedUrl,
      filename: safeFilename,
    };

    // 1. Dispatch CustomEvent for DOM-shared userscripts
    window.dispatchEvent(
      new CustomEvent('muxaro:direct-download', {
        detail,
      })
    );

    const targetOrigin =
      typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : '*';

    // 2. Dispatch window.postMessage for isolated sandboxes / content scripts with safe targetOrigin
    window.postMessage(
      {
        type: 'MUXARO_DIRECT_DOWNLOAD',
        streamUrl: trimmedUrl,
        filename: safeFilename,
        detail,
      },
      targetOrigin
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Requests client-side residential URL extraction through an active MUXARO Direct
 * Chrome Extension or Userscript bridge when server egress is unconfigured or blocked.
 */
export function extractMediaViaDirectBridge(
  targetUrl: string,
  timeoutMs = 12000
): Promise<any | null> {
  if (typeof window === 'undefined' || !targetUrl || !isMuxaroDirectActive()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const requestId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const targetOrigin =
      window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : '*';

    let settled = false;
    const finish = (result: any | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    const onMessage = (event: MessageEvent) => {
      try {
        if (event.source !== window || !event.data || typeof event.data !== 'object') return;
        if (event.origin && event.origin !== 'null' && event.origin !== window.location.origin) return;
        if (
          event.data.source === 'MUXARO_BRIDGE' &&
          event.data.type === 'EXTRACT_RESPONSE' &&
          event.data.requestId === requestId
        ) {
          if (event.data.success && event.data.data) {
            finish(event.data.data);
          } else {
            finish(null);
          }
        }
      } catch {
        // Ignore foreign messages
      }
    };

    window.addEventListener('message', onMessage);
    try {
      window.postMessage(
        {
          source: 'MUXARO_APP',
          type: 'MUXARO_EXTRACT_MEDIA',
          url: targetUrl,
          requestId,
        },
        targetOrigin
      );
    } catch {
      finish(null);
    }
  });
}

