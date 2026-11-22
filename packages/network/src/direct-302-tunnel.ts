/**
 * MUXARO / PROJECT GARUDA - High-Throughput Sovereign Network & Edge Acceleration
 * Deliverable 2: Direct 302 CDN Tunneling Pipeline
 *
 * Implements a zero-bandwidth direct-to-client redirect pipeline for progressive,
 * non-DASH formats (TikTok, Instagram, Twitter/X, and YouTube progressive 720p/360p).
 *
 * Security & Reliability Features:
 * - HMAC-SHA256 tamper-proof token generation and verification
 * - Strict destination CDN domain whitelisting (SSRF & Open Redirect immune)
 * - Referrer-Policy: no-referrer enforcement to prevent CDN 403 hotlinking rejections
 * - Sanitized Content-Disposition attachment headers with RFC 5987 UTF-8 encoding
 * - Client IP affinity enforcement for YouTube progressive formats
 * - Fastify route plugin & telemetry emitter for zero-cost bandwidth accounting
 */

import * as crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type {
  CdnTunnelProvider,
  CdnRedirectPayload,
  Direct302TunnelConfig,
  DirectRedirectResult,
  CdnRedirectEvent,
} from './types.ts';

// =============================================================================
// 1. ALLOWED CDN DOMAIN PATTERNS & SECURITY CONSTRAINTS
// =============================================================================

export const DEFAULT_ALLOWED_CDN_DOMAINS: readonly string[] = [
  // TikTok & ByteDance CDNs
  'tiktokcdn.com',
  'tiktokv.com',
  'musical.ly',
  'bytedance.com',
  'ibytedtos.com',

  // Meta / Instagram CDNs
  'cdninstagram.com',
  'fbcdn.net',
  'instagram.com',

  // Twitter / X CDNs
  'twimg.com',
  'video.twimg.com',

  // Google / YouTube CDNs
  'googlevideo.com',
];

/**
 * Validates that the target URL matches authorized CDN domain suffixes
 * and uses strictly HTTPS with no embedded credentials or IP literals.
 */
export function isAllowedCdnUrl(urlStr: string, allowedDomains: readonly string[] = DEFAULT_ALLOWED_CDN_DOMAINS): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }

  // Must be strictly HTTPS
  if (parsed.protocol !== 'https:') {
    return false;
  }

  // Reject embedded credentials (user:pass@host)
  if (parsed.username || parsed.password) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject private/loopback/cloud metadata
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '169.254.169.254' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.')
  ) {
    return false;
  }

  // Check against allowed CDN domain suffixes
  return allowedDomains.some((domain) => {
    const cleanDomain = domain.toLowerCase().replace(/^\*\./, '');
    return hostname === cleanDomain || hostname.endsWith(`.${cleanDomain}`);
  });
}

// =============================================================================
// 2. CRYPTOGRAPHIC REDIRECT TOKEN SERVICE
// =============================================================================

export class DirectTunnelTokenService {
  private readonly config: Direct302TunnelConfig;
  private readonly secretKey: Buffer;
  private readonly ttlSeconds: number;
  private readonly allowedDomains: readonly string[];

  constructor(config: Direct302TunnelConfig) {
    this.config = config;
    if (!config.secretKey || config.secretKey.length < 16) {
      throw new Error('Direct302TunnelConfig requires a secretKey of at least 16 characters');
    }
    this.secretKey = Buffer.from(config.secretKey, 'utf-8');
    this.ttlSeconds = config.tokenTtlSeconds ?? 120;
    this.allowedDomains = config.allowedDomains ?? DEFAULT_ALLOWED_CDN_DOMAINS;
  }

  /**
   * Generates a tamper-proof HMAC-SHA256 signed redirect token.
   */
  public createSignedToken(params: {
    targetUrl: string;
    provider: CdnTunnelProvider;
    filename: string;
    clientIp?: string;
    customTtlSeconds?: number;
  }): string {
    if (!isAllowedCdnUrl(params.targetUrl, this.allowedDomains)) {
      throw new Error(`Target URL '${params.targetUrl}' is not permitted by CDN domain whitelist`);
    }

    const ttl = params.customTtlSeconds ?? this.ttlSeconds;
    const exp = Math.floor(Date.now() / 1000) + ttl;

    const payload: Omit<CdnRedirectPayload, 'hmac'> = {
      targetUrl: params.targetUrl,
      provider: params.provider,
      filename: sanitizeDownloadFilename(params.filename),
      exp,
      clientIp: params.clientIp,
    };

    const payloadJson = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadJson, 'utf-8').toString('base64url');

    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(payloadBase64)
      .digest('base64url');

    return `${payloadBase64}.${signature}`;
  }

  /**
   * Validates and verifies a signed redirect token.
   * Enforces expiration, signature integrity, and optional client IP binding.
   */
  public verifyToken(token: string, requestingClientIp?: string): CdnRedirectPayload {
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid token structure: expected payload.signature');
    }

    const [payloadBase64, providedSig] = parts;

    // Verify HMAC-SHA256 signature using timing-safe comparison
    const expectedSig = crypto
      .createHmac('sha256', this.secretKey)
      .update(payloadBase64)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    const providedBuf = Buffer.from(providedSig, 'utf-8');

    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      throw new Error('Token HMAC signature verification failed');
    }

    // Decode and parse payload
    let payload: CdnRedirectPayload;
    try {
      const jsonStr = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
      payload = JSON.parse(jsonStr);
    } catch {
      throw new Error('Malformed token JSON payload');
    }

    // Check expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      throw new Error(`Token expired at ${new Date(payload.exp * 1000).toISOString()}`);
    }

    // Check client IP binding if locked in token
    if (payload.clientIp && requestingClientIp) {
      const cleanLockedIp = payload.clientIp.trim();
      const cleanCallerIp = requestingClientIp.trim();
      if (cleanLockedIp !== cleanCallerIp) {
        throw new Error(`Token locked to client IP '${cleanLockedIp}', but requested by '${cleanCallerIp}'`);
      }
    }

    // Re-verify allowed destination URL
    if (!isAllowedCdnUrl(payload.targetUrl, this.allowedDomains)) {
      throw new Error('Destination CDN domain is no longer permitted');
    }

    return payload;
  }
}

// =============================================================================
// 3. ZERO-BANDWIDTH REDIRECT RESPONSE GENERATOR
// =============================================================================

/**
 * Sanitizes filename and generates RFC 5987 / RFC 6266 compliant Content-Disposition header.
 */
export function sanitizeDownloadFilename(filename: string): string {
  const clean = filename.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'media_asset.mp4';
  return clean.length > 200 ? clean.substring(0, 196) + '.mp4' : clean;
}

export function buildContentDispositionHeader(filename: string): string {
  const sanitizedAscii = filename.replace(/[^\x20-\x7E]/g, '_');
  const encodedUtf8 = encodeURIComponent(filename);
  return `attachment; filename="${sanitizedAscii}"; filename*=UTF-8''${encodedUtf8}`;
}

/**
 * Generates the HTTP 302 Found or 307 Temporary Redirect response headers
 * and payload to stream directly from provider CDN with zero server bandwidth.
 */
export function buildDirectCdnRedirect(
  payload: CdnRedirectPayload,
  options?: { statusCode?: 302 | 307 }
): DirectRedirectResult {
  const statusCode = options?.statusCode ?? 302;
  const contentDisposition = buildContentDispositionHeader(payload.filename);

  const headers: Record<string, string> = {
    // Critical: Strip referrer to prevent TikTok & Instagram hotlink blocking
    'Referrer-Policy': 'no-referrer',

    // Prevent intermediate caching of short-lived signed CDN URLs
    'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',

    // Content-Disposition override for direct browser download
    'Content-Disposition': contentDisposition,

    // Security & Origin
    'Location': payload.targetUrl,
    'X-Content-Type-Options': 'nosniff',
    'X-Garuda-Egress': 'direct-302-tunnel',
    'X-Garuda-Provider': payload.provider,
  };

  return {
    statusCode,
    headers,
    redirectUrl: payload.targetUrl,
  };
}

// =============================================================================
// 4. FASTIFY ROUTE PLUGIN
// =============================================================================

export interface FastifyTunnelPluginOptions {
  readonly tokenService: DirectTunnelTokenService;
  readonly routePrefix?: string;
  readonly onRedirect?: (event: CdnRedirectEvent) => void;
}

export const directTunnelFastifyPlugin: FastifyPluginAsync<FastifyTunnelPluginOptions> = async (
  fastify,
  opts
) => {
  const { tokenService, routePrefix = '/api/v1/tunnel', onRedirect } = opts;

  /**
   * GET /api/v1/tunnel/redirect/:token
   * Executes the direct zero-bandwidth 302 redirect
   */
  fastify.get(`${routePrefix}/redirect/:token`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as { token: string };
    const clientIp = (request.headers['cf-connecting-ip'] as string) ||
      (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      request.ip;

    let payload: CdnRedirectPayload;
    try {
      payload = tokenService.verifyToken(token, clientIp);
    } catch (err: any) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_INVALID_REDIRECT_TOKEN',
          message: err.message || 'The streaming redirect token is invalid or has expired',
        },
      });
    }

    const redirectResult = buildDirectCdnRedirect(payload, { statusCode: 302 });

    // Emit zero-cost telemetry event
    if (onRedirect) {
      const parsed = new URL(payload.targetUrl);
      onRedirect({
        provider: payload.provider,
        targetHost: parsed.hostname,
        timestamp: Date.now(),
      });
    }

    // Apply headers and execute 302 redirect
    for (const [key, value] of Object.entries(redirectResult.headers)) {
      reply.header(key, value);
    }

    return reply.redirect(redirectResult.redirectUrl, 302);
  });
};
