/// <reference path="./worker-env.d.ts" />

/**
 * ==============================================================================
 * MUXARO High-Throughput Download Worker (Cloudflare Workers + R2)
 *
 * Implements Part 6.3 Specification:
 * - HMAC-SHA256 signed download token validation (?exp=...&sig=...&fn=...)
 * - Zero egress fee object streaming from Cloudflare R2
 * - Full RFC 7233 HTTP Range support (206 Partial Content, bytes resume & seek)
 * - Anti-tamper token expiry and constant-time signature verification
 * ==============================================================================
 */

export interface Env {
  /** Cloudflare R2 bucket binding for media artifacts */
  BUCKET: R2Bucket;
  /** Secret key shared with Muxaro Fastify API for HMAC generation */
  DOWNLOAD_SIGNING_SECRET: string;
  /** Allowed CORS origins */
  ALLOWED_ORIGIN?: string;
  /** Isolated user-content edge download domain (e.g. muxaro-usercontent.com) */
  USERCONTENT_DOMAIN?: string;
}

/**
 * MIME type map matching Muxaro supported containers and audio extractions
 */
const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/opus",
  zip: "application/zip",
  json: "application/json",
};

/**
 * Convert hex string to Uint8Array safely
 */
function hexToUint8Array(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Constant-time comparison between two Uint8Arrays to eliminate timing attacks
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let c = 0;
  for (let i = 0; i < a.byteLength; i++) {
    c |= a[i] ^ b[i];
  }
  return c === 0;
}

/**
 * Verify HMAC-SHA256 signature using Web Crypto API
 */
async function verifyHmacSignature(
  secret: string,
  message: string,
  expectedHexSig: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );

    const expectedSigBytes = hexToUint8Array(expectedHexSig);
    if (!expectedSigBytes) {
      return false;
    }

    const calculatedSigBuffer = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(message)
    );

    const calculatedSigBytes = new Uint8Array(calculatedSigBuffer);
    return timingSafeEqual(expectedSigBytes, calculatedSigBytes);
  } catch (err) {
    console.error("[DownloadWorker] HMAC verification error:", err);
    return false;
  }
}

/**
 * Resolve content MIME type by filename or file extension
 */
function getContentType(filename: string): string {
  const parts = filename.split(".");
  if (parts.length > 1) {
    const ext = parts.pop()!.toLowerCase();
    if (MIME_TYPES[ext]) {
      return MIME_TYPES[ext];
    }
  }
  return "application/octet-stream";
}

/**
 * Sanitize filename to prevent HTTP Header Injection (CRLF, unescaped quotes)
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[\r\n\t"]/g, "_").trim();
}

/**
 * Cloudflare Worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS Preflight Handling
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, If-Match, If-None-Match, If-Modified-Since",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, ETag, Content-Disposition",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Only GET and HEAD requests are permitted for media downloads
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(
        JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD methods are permitted" }),
        { status: 405, headers: { "Content-Type": "application/json", Allow: "GET, HEAD, OPTIONS" } }
      );
    }

    // Health check endpoint
    if (url.pathname === "/health" || url.pathname === "/_health") {
      return new Response(
        JSON.stringify({ status: "healthy", service: "muxaro-download-worker", time: new Date().toISOString() }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Extract and Validate Query Parameters
    const expParam = url.searchParams.get("exp");
    const sigParam = url.searchParams.get("sig");
    const fnParam = url.searchParams.get("fn") || "";

    if (!expParam || !sigParam) {
      return new Response(
        JSON.stringify({
          error: "MISSING_SIGNATURE",
          message: "Download request must contain 'exp' (expiration) and 'sig' (signature) parameters.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Expiration check (epoch in seconds)
    const now = Math.floor(Date.now() / 1000);
    const exp = parseInt(expParam, 10);
    if (isNaN(exp) || now > exp) {
      return new Response(
        JSON.stringify({
          error: "TOKEN_EXPIRED",
          message: "This download link has expired. Please re-request or re-process the media file.",
          expiredAt: exp,
          currentTime: now,
        }),
        { status: 410, headers: { "Content-Type": "application/json" } }
      );
    }

    // Normalize storage key
    const rawPath = url.pathname;
    const storageKey = rawPath.replace(/^\/+/, "");

    if (!storageKey) {
      return new Response(
        JSON.stringify({ error: "INVALID_PATH", message: "Storage path cannot be empty." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. HMAC-SHA256 Signature Verification
    // Canonical format: `${pathname}:${exp}:${fn}`
    const secret = env.DOWNLOAD_SIGNING_SECRET || "muxaro_dev_download_signing_secret_hmac_sha256";
    const canonicalPayload = `${rawPath}:${expParam}:${fnParam}`;
    let isSigValid = await verifyHmacSignature(secret, canonicalPayload, sigParam);

    // Fallback verification against normalized storageKey if path had leading slashes
    if (!isSigValid && storageKey !== rawPath) {
      const altPayload = `${storageKey}:${expParam}:${fnParam}`;
      isSigValid = await verifyHmacSignature(secret, altPayload, sigParam);
    }

    if (!isSigValid) {
      return new Response(
        JSON.stringify({
          error: "INVALID_SIGNATURE",
          message: "Cryptographic signature verification failed. Download request has been rejected.",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Retrieve Object from Cloudflare R2 Bucket with HTTP Range Support
    const rangeHeader = request.headers.get("range");
    let r2Object: R2ObjectBody | R2Object | null = null;

    try {
      if (rangeHeader) {
        // R2 supports range passing directly via Headers or R2Range object
        r2Object = await env.BUCKET.get(storageKey, {
          range: request.headers,
          onlyIf: request.headers,
        });
      } else {
        r2Object = await env.BUCKET.get(storageKey, {
          onlyIf: request.headers,
        });
      }
    } catch (err: any) {
      console.error(`[DownloadWorker] R2 fetch error for key "${storageKey}":`, err);
      return new Response(
        JSON.stringify({ error: "STORAGE_ERROR", message: "Failed to retrieve object from storage." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!r2Object) {
      return new Response(
        JSON.stringify({
          error: "NOT_FOUND",
          message: "The requested media artifact was not found or has been purged by lifecycle retention.",
          key: storageKey,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5. Construct Optimized Streaming Response with Domain Isolation & Anti-XSS Hardening
    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN || "*");
    responseHeaders.set("Accept-Ranges", "bytes");

    // Filename resolution & sanitization
    const defaultFilename = storageKey.split("/").pop() || "media-file";
    const finalFilename = sanitizeFilename(fnParam || defaultFilename);

    // =========================================================================
    // Edge Download Domain Isolation Specs for muxaro-usercontent.com:
    // Mandatory Anti-XSS Defense Headers:
    // 1. Content-Disposition: attachment (forces download prompt, blocks browser inline execution)
    // 2. Content-Type: application/octet-stream (prevents interpretation as HTML/SVG/XML/script)
    // 3. nosniff (prohibits browser MIME-type sniffing)
    // 4. CSP: sandbox; default-src 'none' (null origin sandbox context)
    // 5. X-Frame-Options: DENY (anti-clickjacking / framing prevention)
    // 6. Referrer-Policy: no-referrer (prevents token / URL exfiltration)
    // =========================================================================
    responseHeaders.set("Content-Type", "application/octet-stream");
    responseHeaders.set(
      "Content-Disposition",
      `attachment; filename="${finalFilename}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`
    );
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("Content-Security-Policy", "sandbox; default-src 'none'");
    responseHeaders.set("X-Frame-Options", "DENY");
    responseHeaders.set("Referrer-Policy", "no-referrer");
    responseHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
    responseHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

    // Cache control: artifacts are immutable once created
    responseHeaders.set("Cache-Control", "public, max-age=3600, immutable");

    // ETag & Last Modified
    if (r2Object.httpEtag) {
      responseHeaders.set("ETag", r2Object.httpEtag);
    }
    if (r2Object.uploaded) {
      responseHeaders.set("Last-Modified", r2Object.uploaded.toUTCString());
    }

    // Status code: 206 for Partial Content (Range), 200 for full payload
    let statusCode = 200;

    // Check if range was satisfied
    if ("range" in r2Object && r2Object.range) {
      const range = (r2Object as any).range;
      statusCode = 206;
      const endOffset = range.offset + range.length - 1;
      responseHeaders.set("Content-Range", `bytes ${range.offset}-${endOffset}/${r2Object.size}`);
      responseHeaders.set("Content-Length", range.length.toString());
    } else {
      responseHeaders.set("Content-Length", r2Object.size.toString());
    }

    // For HEAD requests, omit the response stream body
    if (request.method === "HEAD") {
      return new Response(null, {
        status: statusCode,
        headers: responseHeaders,
      });
    }

    // Stream directly from R2 without downloading entire file into worker memory
    const bodyStream = "body" in r2Object ? (r2Object as R2ObjectBody).body : null;

    return new Response(bodyStream, {
      status: statusCode,
      headers: responseHeaders,
    });
  },
};
