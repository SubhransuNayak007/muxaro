/**
 * Cloudflare Pages Functions - Edge API Utilities
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-muxaro-csrf, x-idempotency-key, x-session-token',
  'Access-Control-Max-Age': '86400',
};

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

export function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
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
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
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

export const DEFAULT_UPSTREAM_URL = 'http://13.62.158.211.nip.io';

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
    env?.API_URL ||
    DEFAULT_UPSTREAM_URL;
  if (!isSafeUpstreamUrl(upstreamBase)) {
    return null;
  }

  try {
    const targetUrl = new URL(
      `${upstreamBase.replace(/\/+$/, '')}/api/v1/${subpath.replace(/^\/+/, '')}`
    );

    // Copy query parameters from original request
    const incomingUrl = new URL(request.url);
    incomingUrl.searchParams.forEach((val, key) => {
      targetUrl.searchParams.set(key, val);
    });

    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', incomingUrl.host);
    headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));

    const controller = new AbortController();
    // 45s timeout to allow Cloud Run / EC2 processing and complex multi-stream yt-dlp inspection
    const timeout = setTimeout(() => controller.abort(), 45000);

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

    // Merge CORS headers into upstream response
    const respHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => {
      respHeaders.set(k, v);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    });
  } catch {
    // Upstream unreachable or timed out; seamlessly degrade to Edge handler
    return null;
  }
}
