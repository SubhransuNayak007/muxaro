import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';

export const DEAD_OR_UNRESOLVABLE_BACKEND_HOSTS = [
  'api.muxaro.app',
  'muxaro-api.internal',
] as const;

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function isDeadBackendHost(candidate: string): boolean {
  const lower = candidate.trim().toLowerCase();
  if (!lower) return true;
  return DEAD_OR_UNRESOLVABLE_BACKEND_HOSTS.some((host) => lower.includes(host));
}

export function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL === '1' ||
      process.env.VERCEL_ENV ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY === 'true'
  );
}

/**
 * Resolves the authoritative backend Fastify API base URL at request runtime.
 * Returns null if no live backend URL is configured, or if configured to a dead host.
 */
export function resolveBackendBaseUrl(): string | null {
  const candidates = [
    process.env.API_INTERNAL_URL,
    process.env.BACKEND_API_URL,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_API_BASE_URL,
  ];

  const enableLocalProxy =
    process.env.ENABLE_BACKEND_PROXY === '1' ||
    process.env.ENABLE_BACKEND_PROXY === 'true';

  for (const raw of candidates) {
    const trimmed = (raw || '').trim();
    if (!trimmed) continue;
    if (isDeadBackendHost(trimmed)) continue;
    if (!/^https?:\/\//i.test(trimmed)) continue;

    const isLocal =
      trimmed.includes('127.0.0.1') || trimmed.includes('localhost');
    if (isLocal && process.env.NODE_ENV === 'production' && !enableLocalProxy) {
      continue;
    }

    return trimmed.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');
  }

  return null;
}

export interface ProxyOptions {
  timeoutMs?: number;
  streaming?: boolean;
}

/**
 * Proxies an incoming Next.js App Router request to the external Fastify API (`API_INTERNAL_URL`).
 * Preserves request/response streaming (including SSE text/event-stream and binary downloads).
 * Returns `null` when no external backend is configured.
 */
export async function proxyToBackend(
  req: NextRequest | Request,
  apiSubpath: string,
  options: ProxyOptions = {}
): Promise<NextResponse | null> {
  const backendBase = resolveBackendBaseUrl();
  if (!backendBase) return null;

  const cleanSubpath = apiSubpath.replace(/^\/+/, '');
  const targetUrl = new URL(`${backendBase}/api/v1/${cleanSubpath}`);
  const parsedIncoming =
    'nextUrl' in req && req.nextUrl ? req.nextUrl : new URL(req.url);
  const incomingSearch = parsedIncoming.searchParams.toString();
  if (incomingSearch) {
    targetUrl.search = incomingSearch;
  }

  const forwardHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  if (!forwardHeaders.has('x-forwarded-host') && req.headers.get('host')) {
    forwardHeaders.set('x-forwarded-host', req.headers.get('host') || '');
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? (options.streaming ? 300_000 : 30_000);
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());

  try {
    const fetchInit: RequestInit & { duplex?: 'half' } = {
      method: req.method,
      headers: forwardHeaders,
      redirect: 'manual',
      signal: controller.signal,
    };

    if (hasBody && req.body) {
      fetchInit.body = req.body;
      fetchInit.duplex = 'half';
    }

    const upstreamRes = await fetch(targetUrl.toString(), fetchInit);
    if (timer) clearTimeout(timer);

    const responseHeaders = new Headers();
    upstreamRes.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    if (timer) clearTimeout(timer);
    const isAbort = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    return NextResponse.json(
      {
        ok: false,
        success: false,
        code: isAbort ? 'TIMEOUT' : 'ERR_BACKEND_UNREACHABLE',
        error: {
          code: isAbort ? 'TIMEOUT' : 'ERR_BACKEND_UNREACHABLE',
          message: isAbort
            ? 'Backend service request timed out.'
            : `Backend service unavailable: ${err?.message || 'Connection failed'}`,
        },
        requestId: `proxy_err_${Date.now()}`,
      },
      { status: isAbort ? 504 : 502 }
    );
  }
}

export interface BinaryProbeResult {
  ytdlp: { available: boolean; version?: string };
  ffmpeg: { available: boolean; version?: string };
  ffprobe: { available: boolean; version?: string };
  deno: { available: boolean; version?: string };
}

function queryBinaryVersion(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val?: string) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };

    const timer = setTimeout(() => finish(undefined), 3000);
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(undefined);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        finish(stdout.trim().split(/\r?\n/)[0].trim());
      } else {
        finish(undefined);
      }
    });
  });
}

let cachedBinaryProbe: { result: BinaryProbeResult; ts: number } | null = null;

export async function probeLocalMediaBinaries(): Promise<BinaryProbeResult> {
  const now = Date.now();
  if (cachedBinaryProbe && now - cachedBinaryProbe.ts < 30_000) {
    return cachedBinaryProbe.result;
  }

  const [ytdlpVer, ffmpegVerRaw, ffprobeVerRaw, denoVerRaw] = await Promise.all([
    queryBinaryVersion(process.env.YTDLP_PATH || 'yt-dlp', ['--version']),
    queryBinaryVersion(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']),
    queryBinaryVersion(process.env.FFPROBE_PATH || 'ffprobe', ['-version']),
    queryBinaryVersion(process.env.DENO_PATH || 'deno', ['--version']),
  ]);

  const ffmpegMatch = ffmpegVerRaw?.match(/ffmpeg version ([^\s]+)/i);
  const ffprobeMatch = ffprobeVerRaw?.match(/ffprobe version ([^\s]+)/i);
  const denoMatch = denoVerRaw?.match(/deno ([^\s]+)/i);

  const result: BinaryProbeResult = {
    ytdlp: { available: Boolean(ytdlpVer), version: ytdlpVer },
    ffmpeg: { available: Boolean(ffmpegVerRaw), version: ffmpegMatch ? ffmpegMatch[1] : ffmpegVerRaw },
    ffprobe: { available: Boolean(ffprobeVerRaw), version: ffprobeMatch ? ffprobeMatch[1] : ffprobeVerRaw },
    deno: { available: Boolean(denoVerRaw), version: denoMatch ? denoMatch[1] : denoVerRaw },
  };

  cachedBinaryProbe = { result, ts: now };
  return result;
}
