/**
 * Project MUXARO - Safe HTTP Media Inspector
 * 
 * Performs resilient, SSRF-safe HTTP header inspection for direct media streams:
 * - Issues HTTP HEAD request with timeout
 * - Follows redirects up to maxRedirects while re-validating each target against SSRF
 * - Automatically falls back to Range GET (bytes=0-0) if HEAD returns 405 Method Not Allowed
 * - Extracts Content-Type, Content-Length, Accept-Ranges, Content-Disposition
 */

import { assertSsrfSafe } from '../ssrf-filter.ts';
import { InspectionTimeoutError, InvalidMediaError } from '../errors.ts';

export interface HttpInspectionResult {
  statusCode: number;
  finalUrl: string;
  contentType: string | null;
  contentLengthBytes: number | null;
  contentDisposition: string | null;
  acceptRanges: boolean;
  headers: Record<string, string>;
  isRangeSupported: boolean;
  etag?: string;
  lastModified?: string;
}

export interface HttpInspectionOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
  customHeaders?: Record<string, string>;
  resolveDns?: boolean;
  customSsrfValidator?: (url: string) => Promise<{ isSafe: boolean; override?: boolean; reason?: string }>;
}

const DEFAULT_USER_AGENT = 'MUXARO-MediaInspector/1.0 (+https://muxaro.app/bot)';

/**
 * Perform safe HTTP HEAD / Range-GET inspection of a media URL
 */
export async function inspectHttpMediaHeaders(
  rawUrl: string,
  options?: HttpInspectionOptions
): Promise<HttpInspectionResult> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const maxRedirects = options?.maxRedirects ?? 3;
  const userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;

  let currentUrl = rawUrl;
  let redirectsRemaining = maxRedirects;

  while (true) {
    // Re-verify SSRF on each jump
    await assertSsrfSafe(currentUrl, {
      resolveDns: options?.resolveDns ?? true,
      customValidator: options?.customSsrfValidator,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      Accept: '*/*',
      ...(options?.customHeaders || {}),
    };

    try {
      // 1. Try HEAD request first
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: 'HEAD',
          headers,
          signal: controller.signal,
          redirect: 'manual', // handle redirects explicitly for SSRF safety
        });
      } catch (fetchErr: unknown) {
        if (controller.signal.aborted) {
          throw new InspectionTimeoutError(timeoutMs, currentUrl);
        }
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      // Handle Redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new InvalidMediaError(`HTTP redirect status ${response.status} missing Location header`, {
            url: currentUrl,
          });
        }
        if (redirectsRemaining <= 0) {
          throw new InvalidMediaError(`Maximum redirect limit (${maxRedirects}) exceeded while inspecting URL`, {
            url: rawUrl,
          });
        }
        redirectsRemaining--;
        // Resolve relative redirect against current URL
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      // If HEAD returns 405 Method Not Allowed or 501, fall back to Range: bytes=0-0 GET
      if (response.status === 405 || response.status === 501) {
        return await executeRangeFallback(currentUrl, headers, timeoutMs);
      }

      // If response status is not 2xx, check if Range GET works
      if (response.status < 200 || response.status >= 300) {
        // Attempt Range GET fallback before giving up
        try {
          return await executeRangeFallback(currentUrl, headers, timeoutMs);
        } catch {
          throw new InvalidMediaError(`Target server returned HTTP ${response.status} for HEAD request`, {
            url: currentUrl,
            status: response.status,
          });
        }
      }

      // Successfully received 2xx on HEAD
      return parseResponseHeaders(response, currentUrl);
    } catch (err: unknown) {
      if (err instanceof InspectionTimeoutError || err instanceof InvalidMediaError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new InvalidMediaError(`Failed to connect to source media server: ${message}`, {
        url: currentUrl,
        error: message,
      });
    }
  }
}

/**
 * Fallback to Range: bytes=0-0 GET for servers that reject or malform HEAD requests
 */
async function executeRangeFallback(
  url: string,
  baseHeaders: Record<string, string>,
  timeoutMs: number
): Promise<HttpInspectionResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const rangeHeaders = {
      ...baseHeaders,
      Range: 'bytes=0-0',
    };

    const response = await fetch(url, {
      method: 'GET',
      headers: rangeHeaders,
      signal: controller.signal,
      redirect: 'follow', // standard follow for final fallback
    });

    if (response.status !== 200 && response.status !== 206) {
      throw new InvalidMediaError(`Range fallback returned HTTP ${response.status}`, {
        url,
        status: response.status,
      });
    }

    // Immediately cancel the response body stream to avoid downloading data
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {
        // Ignore stream cancel error
      }
    }

    const result = parseResponseHeaders(response, url);

    // If Content-Range header is present, parse total length: "bytes 0-0/12345678"
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+|\*)$/);
      if (match && match[1] !== '*') {
        result.contentLengthBytes = Number.parseInt(match[1], 10);
      }
    }

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse headers from Fetch Response into HttpInspectionResult
 */
function parseResponseHeaders(response: Response, finalUrl: string): HttpInspectionResult {
  const headersObj: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headersObj[key.toLowerCase()] = value;
  });

  const contentType = response.headers.get('content-type');
  const contentLengthStr = response.headers.get('content-length');
  const contentDisposition = response.headers.get('content-disposition');
  const acceptRanges = response.headers.get('accept-ranges');
  const etag = response.headers.get('etag') || undefined;
  const lastModified = response.headers.get('last-modified') || undefined;

  let contentLengthBytes: number | null = null;
  if (contentLengthStr && /^\d+$/.test(contentLengthStr)) {
    contentLengthBytes = Number.parseInt(contentLengthStr, 10);
  }

  const isRangeSupported = acceptRanges?.toLowerCase() === 'bytes' || response.status === 206;

  return {
    statusCode: response.status,
    finalUrl,
    contentType,
    contentLengthBytes,
    contentDisposition,
    acceptRanges: isRangeSupported,
    headers: headersObj,
    isRangeSupported,
    etag,
    lastModified,
  };
}
