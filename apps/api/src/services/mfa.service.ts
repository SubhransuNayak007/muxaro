/**
 * Project MUXARO - RFC 6238 TOTP Multi-Factor Authentication Service
 * Pure Node.js implementation (HMAC-SHA1, 30s period, 6 digits, +/-1 step skew)
 * Encrypts TOTP secrets at rest with AES-256-GCM.
 */

import crypto from 'node:crypto';
import { config } from '../config.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_DEFAULT_SKEW = 1;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s=-]+/g, '');
  if (!cleaned) {
    throw new Error('Invalid base32 secret');
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error('Invalid character in base32 secret');
    }
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a 160-bit cryptographically secure random Base32 TOTP secret.
 */
export function generateTotpSecret(byteLength: number = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

/**
 * Generates an RFC-compatible otpauth:// URI for authenticator apps.
 */
export function generateTotpUri(params: {
  secret: string;
  email: string;
  issuer?: string;
}): string {
  const issuer = params.issuer || 'MUXARO';
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(params.email)}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/**
 * Computes RFC 4226 HOTP / RFC 6238 TOTP for a given 64-bit counter.
 */
export function computeTotpAtCounter(
  secretBase32: string,
  counter: number,
  digits: number = TOTP_DIGITS
): string {
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  counterBuf.writeUInt32BE(high, 0);
  counterBuf.writeUInt32BE(low, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  return String(otp).padStart(digits, '0');
}

/**
 * Computes the current TOTP code (primarily useful for tests and verification).
 */
export function generateCurrentTotp(secretBase32: string, nowMs: number = Date.now()): string {
  const counter = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
  return computeTotpAtCounter(secretBase32, counter, TOTP_DIGITS);
}

/**
 * Verifies a 6-digit TOTP code using constant-time comparison across +/- skew steps.
 */
export function verifyTotpCode(
  secretBase32: string,
  rawCode: string,
  options?: {
    nowMs?: number;
    periodSeconds?: number;
    skew?: number;
    lastAcceptedCounter?: number | null;
  }
): { valid: boolean; matchedCounter?: number } {
  const normalized = String(rawCode || '').replace(/[\s-]+/g, '');
  if (!/^\d{6}$/.test(normalized)) {
    return { valid: false };
  }

  const nowMs = options?.nowMs ?? Date.now();
  const period = options?.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const skew = options?.skew ?? TOTP_DEFAULT_SKEW;
  const currentCounter = Math.floor(nowMs / 1000 / period);
  const providedBuf = Buffer.from(normalized, 'utf8');

  for (let delta = -skew; delta <= skew; delta++) {
    const candidateCounter = currentCounter + delta;
    if (candidateCounter < 0) continue;
    if (
      typeof options?.lastAcceptedCounter === 'number' &&
      candidateCounter <= options.lastAcceptedCounter
    ) {
      continue;
    }

    const expected = computeTotpAtCounter(secretBase32, candidateCounter, TOTP_DIGITS);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { valid: true, matchedCounter: candidateCounter };
    }
  }

  return { valid: false };
}

function getMfaEncryptionKey(): Buffer {
  const keyMaterial = process.env.MFA_ENCRYPTION_KEY || config.sessionSecret;
  return crypto.createHash('sha256').update(`muxaro:mfa:v1:${keyMaterial}`).digest();
}

/**
 * Encrypts a TOTP secret for database storage using AES-256-GCM.
 */
export function encryptMfaSecret(secretBase32: string): string {
  const key = getMfaEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

/**
 * Decrypts a stored AES-256-GCM TOTP secret.
 */
export function decryptMfaSecret(stored: string): string {
  if (!stored) {
    throw new Error('Missing MFA secret');
  }
  if (!stored.startsWith('v1:')) {
    // Allow reading legacy plain base32 if ever seeded directly
    return stored;
  }
  const parts = stored.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted MFA secret');
  }
  const [, ivB64, tagB64, encB64] = parts;
  const key = getMfaEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export const mfaService = {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotpUri,
  computeTotpAtCounter,
  generateCurrentTotp,
  verifyTotpCode,
  encryptMfaSecret,
  decryptMfaSecret,
};
