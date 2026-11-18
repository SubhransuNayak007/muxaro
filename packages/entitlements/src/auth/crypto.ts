/**
 * @file crypto.ts
 * Cryptographic utilities for secure tokens, hashing, and HMAC signing
 */

import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Generate a cryptographically secure random token (hex or base64url).
 */
export function generateSecureToken(byteLength: number = 32, encoding: 'hex' | 'base64url' = 'hex'): string {
  const buf = randomBytes(byteLength);
  return encoding === 'base64url' ? buf.toString('base64url') : buf.toString('hex');
}

/**
 * Generate a unique prefixed ID (e.g. `usr_...`, `res_...`, `led_...`, `sess_...`).
 */
export function generateId(prefix: string): string {
  const randomPart = randomBytes(16).toString('hex');
  const timestamp = Date.now().toString(36);
  return `${prefix}_${timestamp}${randomPart.slice(0, 16)}`;
}

/**
 * SHA-256 hash a string.
 */
export function hashString(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Create a deterministic hash for request payload idempotency verification.
 */
export function hashRequestPayload(payload: unknown): string {
  if (payload === undefined || payload === null) {
    return hashString('');
  }
  const serialized = typeof payload === 'string' ? payload : canonicalStringify(payload);
  return hashString(serialized);
}

/**
 * Deterministically serialize JSON by sorting object keys recursively.
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalStringify).join(',')}]`;
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalStringify(val)}`;
  });
  return `{${pairs.join(',')}}`;
}

/**
 * Create an HMAC-SHA256 signature for data tampering detection.
 */
export function createHmacSignature(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

/**
 * Constant-time HMAC signature verification to prevent timing attacks.
 */
export function verifyHmacSignature(data: string, signature: string, secret: string): boolean {
  if (!signature || !data || !secret) {
    return false;
  }
  try {
    const expected = createHmacSignature(data, secret);
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}
