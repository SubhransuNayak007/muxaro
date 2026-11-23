/**
 * Project MUXARO - Secure Download Token Signer & Verifier
 * 
 * Provides:
 * - HMAC-SHA256 token signing and verification for download authorization
 * - Base64URL encoding/decoding compliant with RFC 7515
 * - Timing-safe constant-time comparison to defeat side-channel timing attacks
 * - Strict expiration enforcement (TTL / expiresAt)
 * - Prototype pollution defense on parsed JSON payload
 * - Strict schema validation on payload fields (jobId, artifactId, filename, userId, expiresAt)
 * - Safe filename sanitization defense to guarantee no directory traversal
 */

import * as crypto from 'node:crypto';
import { sanitizeFilename } from './ffmpeg-sanitizer.ts';
import { hasPrototypePollution } from './validation.ts';

export interface SignedDownloadTokenPayload {
  jobId: string;
  artifactId: string;
  filename: string;
  userId: string;
  expiresAt: number;
}

export interface TokenSignOptions {
  ttlSeconds?: number;
}

export interface TokenVerifyOptions {
  /** Optional clock tolerance in milliseconds (default: 0) */
  clockToleranceMs?: number;
}

/**
 * Minimum secret entropy requirement (16 bytes = 128 bits)
 */
export const MIN_SECRET_LENGTH = 16;

/**
 * Sign a download authorization payload with HMAC-SHA256
 */
export function signDownloadToken(
  payload: {
    jobId: string;
    artifactId: string;
    filename: string;
    userId: string;
    ttlSeconds?: number;
    expiresAt?: number;
  },
  secret: string
): string {
  if (!secret || typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `Token signing failed: secret must be a string with at least ${MIN_SECRET_LENGTH} characters for adequate security`
    );
  }

  if (!payload.jobId || typeof payload.jobId !== 'string') {
    throw new Error('Token signing failed: jobId must be a non-empty string');
  }
  if (!payload.artifactId || typeof payload.artifactId !== 'string') {
    throw new Error('Token signing failed: artifactId must be a non-empty string');
  }
  if (!payload.userId || typeof payload.userId !== 'string') {
    throw new Error('Token signing failed: userId must be a non-empty string');
  }

  const sanitizedFilename = sanitizeFilename(payload.filename || 'media_output');
  const ttl = payload.ttlSeconds ?? 3600;
  const expiresAt = payload.expiresAt ?? (Date.now() + ttl * 1000);

  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('Token signing failed: expiresAt must be a positive finite timestamp');
  }

  const cleanPayload: SignedDownloadTokenPayload = {
    jobId: payload.jobId.trim(),
    artifactId: payload.artifactId.trim(),
    filename: sanitizedFilename,
    userId: payload.userId.trim(),
    expiresAt: Math.floor(expiresAt)
  };

  const payloadJson = JSON.stringify(cleanPayload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Verify an HMAC-SHA256 signed download token
 */
export function verifyDownloadToken(
  token: string,
  secret: string,
  options: TokenVerifyOptions = {}
): SignedDownloadTokenPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('Download token verification failed: token is missing or not a string');
  }

  if (!secret || typeof secret !== 'string') {
    throw new Error('Download token verification failed: secret key is missing');
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Download token verification failed: malformed token format (expected payload.signature)');
  }

  const [payloadB64, signature] = parts;

  // Recompute expected HMAC-SHA256 signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');

  // Constant-time comparison
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expectedSignature, 'utf8');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Download token verification failed: invalid signature or token was tampered with');
  }

  // Parse JSON payload
  let rawParsed: unknown;
  try {
    const jsonStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    rawParsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Download token verification failed: payload is not valid JSON');
  }

  if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
    throw new Error('Download token verification failed: payload must be a JSON object');
  }

  if (hasPrototypePollution(rawParsed)) {
    throw new Error('Download token verification failed: prototype pollution attempt detected');
  }

  const p = rawParsed as Record<string, any>;

  if (typeof p.jobId !== 'string' || !p.jobId.trim()) {
    throw new Error('Download token verification failed: payload missing valid jobId');
  }
  if (typeof p.artifactId !== 'string' || !p.artifactId.trim()) {
    throw new Error('Download token verification failed: payload missing valid artifactId');
  }
  if (typeof p.filename !== 'string' || !p.filename.trim()) {
    throw new Error('Download token verification failed: payload missing valid filename');
  }
  if (typeof p.userId !== 'string' || !p.userId.trim()) {
    throw new Error('Download token verification failed: payload missing valid userId');
  }
  if (typeof p.expiresAt !== 'number' || !Number.isFinite(p.expiresAt) || p.expiresAt <= 0) {
    throw new Error('Download token verification failed: payload missing valid expiresAt timestamp');
  }

  const clockTolerance = options.clockToleranceMs ?? 0;
  if (Date.now() - clockTolerance > p.expiresAt) {
    throw new Error('Download token verification failed: token has expired');
  }

  return {
    jobId: p.jobId.trim(),
    artifactId: p.artifactId.trim(),
    filename: sanitizeFilename(p.filename),
    userId: p.userId.trim(),
    expiresAt: p.expiresAt
  };
}
