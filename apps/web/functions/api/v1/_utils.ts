/**
 * Cloudflare Pages Functions - Edge API Utilities
 */

const ALLOWED_EXACT_ORIGINS = new Set([
  'https://muxaro.app',
  'https://www.muxaro.app',
  'https://muxaro.pages.dev',
  'https://muxaro.vercel.app',
]);

export function isAllowedCorsOrigin(origin: string): boolean {
  if (!origin || origin === 'null') return false;
  if (ALLOWED_EXACT_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (host === 'localhost' || host === '127.0.0.1')
    ) {
      return true;
    }
    if (
      parsed.protocol === 'https:' &&
      (host.endsWith('.muxaro.pages.dev') || host === 'muxaro.pages.dev' || host.endsWith('.muxaro.app'))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export const SECURITY_API_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://muxaro.app',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-muxaro-csrf, x-idempotency-key, x-session-token, x-file-name, x-request-id, x-captcha-token, x-turnstile-token',
  'Access-Control-Max-Age': '86400',
};

/**
 * Returns origin-validated CORS headers.
 * Only echoes trusted MUXARO / localhost origins with credentials; never reflects arbitrary origins.
 */
export function getCorsHeaders(requestOrOrigin?: Request | string | null): Record<string, string> {
  let origin = '';
  if (typeof requestOrOrigin === 'string') {
    origin = requestOrOrigin;
  } else if (requestOrOrigin && typeof requestOrOrigin === 'object' && 'headers' in requestOrOrigin) {
    origin = requestOrOrigin.headers.get('origin') || '';
    if (!origin) {
      try {
        origin = new URL(requestOrOrigin.url).origin;
      } catch {
        origin = '';
      }
    }
  }

  const allowed = isAllowedCorsOrigin(origin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://muxaro.app',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, x-muxaro-csrf, x-idempotency-key, x-session-token, x-file-name, x-request-id, x-captcha-token, x-turnstile-token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (allowed) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  request?: Request
): Response {
  const dynamicCors = request ? getCorsHeaders(request) : corsHeaders;
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...SECURITY_API_HEADERS,
      ...dynamicCors,
      ...extraHeaders,
    },
  });
}

export function optionsResponse(request?: Request): Response {
  const dynamicCors = request ? getCorsHeaders(request) : corsHeaders;
  return new Response(null, {
    status: 204,
    headers: {
      ...SECURITY_API_HEADERS,
      ...dynamicCors,
    },
  });
}

export function generateRequestId(prefix = 'edge_'): string {
  try {
    const random = crypto.randomUUID().slice(0, 8);
    return `${prefix}${Date.now()}_${random}`;
  } catch {
    return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null);
  if (!header) return cookies;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

/**
 * Edge-compatible SSRF guard for user-supplied URLs in Cloudflare Pages Functions.
 */
export function isSafePublicHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;

    let host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1);
    }
    if (!host) return false;

    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === 'metadata.google.internal' ||
      host === 'metadata' ||
      host === 'instance-data' ||
      host === 'broadcasthost'
    ) {
      return false;
    }

    // Block decimal/octal/hex obfuscated IPv4 literals (e.g. 2130706433, 0177.0.0.1, 0x7f000001)
    if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
    if (/^(\d+|0x[0-9a-f]+)(\.(\d+|0x[0-9a-f]+)){1,3}$/i.test(host)) {
      const octets = host.split('.').map((p) =>
        p.startsWith('0x') ? Number.parseInt(p, 16) : p.startsWith('0') && p.length > 1 ? Number.parseInt(p, 8) : Number.parseInt(p, 10)
      );
      if (octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
      const [a, b] = octets;
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        a >= 224
      ) {
        return false;
      }
    }

    // Block private/loopback/link-local IPv6
    if (host.includes(':')) {
      if (
        host === '::' ||
        host === '::1' ||
        host.startsWith('fe80:') ||
        host.startsWith('fc') ||
        host.startsWith('fd') ||
        host.startsWith('ff') ||
        host.includes('::ffff:')
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function isValidResourceId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{3,96}$/.test(id);
}

const DEAD_UPSTREAM_HOSTS = ['api.muxaro.app', 'muxaro-api.internal'];

/**
 * Checks if an upstream URL is safe to attempt (rejects known dead domains like api.muxaro.app).
 */
export function isSafeUpstreamUrl(url: string | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;
  for (const dead of DEAD_UPSTREAM_HOSTS) {
    if (trimmed.includes(dead)) return false;
  }
  return true;
}

export const DEFAULT_UPSTREAM_URL = '';

/**
 * Attempts proxying to a configured live upstream API (Fastify / Cloud Run / EC2).
 * Returns null if upstream is unconfigured, disabled, or fails (timeout / network error).
 */
export async function tryProxyUpstream(
  request: Request,
  env: Record<string, any>,
  subpath: string
): Promise<Response | null> {
  const upstreamBase =
    env?.UPSTREAM_API_URL ||
    env?.API_UPSTREAM_URL ||
    env?.FASTIFY_API_URL ||
    env?.API_INTERNAL_URL ||
    env?.API_URL;
  if (!isSafeUpstreamUrl(upstreamBase)) {
    return null;
  }

  const normalizedSubpath = subpath.replace(/^\/+/, '');
  if (
    !normalizedSubpath ||
    normalizedSubpath.includes('..') ||
    /%2f|%5c|%00/i.test(normalizedSubpath) ||
    /[\r\n\0\\]/.test(normalizedSubpath)
  ) {
    return null;
  }

  try {
    const targetUrl = new URL(`${upstreamBase.replace(/\/+$/, '')}/api/v1/${normalizedSubpath}`);

    // Copy query parameters from original request
    const incomingUrl = new URL(request.url);
    incomingUrl.searchParams.forEach((val, key) => {
      targetUrl.searchParams.set(key, val);
    });

    const headers = new Headers(request.headers);
    headers.delete('x-forwarded-for');
    headers.delete('x-real-ip');
    headers.delete('true-client-ip');
    headers.set('x-forwarded-host', incomingUrl.host);
    headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const init: RequestInit = {
      method: request.method,
      headers,
      signal: controller.signal,
      redirect: 'manual',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        init.body = await request.clone().arrayBuffer();
      } catch {
        // Ignored
      }
    }

    const response = await fetch(targetUrl.toString(), init);
    clearTimeout(timeout);

    const respHeaders = new Headers(response.headers);
    Object.entries(SECURITY_API_HEADERS).forEach(([k, v]) => respHeaders.set(k, v));
    const dynamicCors = getCorsHeaders(request);
    Object.entries(dynamicCors).forEach(([k, v]) => {
      respHeaders.set(k, v);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    });
  } catch {
    return null;
  }
}
