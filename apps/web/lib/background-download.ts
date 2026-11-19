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
