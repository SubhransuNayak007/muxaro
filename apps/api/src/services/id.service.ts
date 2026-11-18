/**
 * Project MUXARO - Unique Identifier Generation Service
 *
 * Standards:
 * - Internal User ID: UUIDv7 (time-ordered RFC 9562)
 * - Public User ID:   MXR-XXXXXXXX (8 chars from Crockford/non-ambiguous base32, never sequential)
 * - Batch ID:         MXB-YYYYMMDD-XXXXXX
 * - Job ID:           MXJ-XXXXXXXXXX
 * - Reward Session:   MXRWD-XXXXXXXXXXXX
 * - Request / Event:  req_... / evt_...
 */

import crypto from 'node:crypto';

// Non-ambiguous uppercase base32 alphabet (excludes 0, O, 1, I, L)
const SAFE_BASE32 = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomBase32(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SAFE_BASE32[bytes[i] % SAFE_BASE32.length];
  }
  return out;
}

/**
 * Generates an RFC 9562 UUIDv7 (48-bit Unix epoch ms + 74 random bits).
 */
export function generateInternalUserId(): string {
  const nowMs = BigInt(Date.now());
  const bytes = crypto.randomBytes(16);

  // Write 48-bit big-endian timestamp into bytes 0..5
  bytes[0] = Number((nowMs >> 40n) & 0xffn);
  bytes[1] = Number((nowMs >> 32n) & 0xffn);
  bytes[2] = Number((nowMs >> 24n) & 0xffn);
  bytes[3] = Number((nowMs >> 16n) & 0xffn);
  bytes[4] = Number((nowMs >> 8n) & 0xffn);
  bytes[5] = Number(nowMs & 0xffn);

  // Set version 7 (0111) in high nibble of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Set RFC 4122/9562 variant (10xx) in high 2 bits of byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Generates a customer-safe Public User ID: MXR-XXXXXXXX
 */
export function generatePublicUserId(): string {
  return `MXR-${randomBase32(8)}`;
}

/**
 * Generates a Batch ID: MXB-YYYYMMDD-XXXXXX
 */
export function generateBatchId(date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `MXB-${yyyy}${mm}${dd}-${randomBase32(6)}`;
}

/**
 * Generates a Processing Job ID: MXJ-XXXXXXXXXX
 */
export function generateJobId(): string {
  return `MXJ-${randomBase32(10)}`;
}

/**
 * Generates a Reward Session ID: MXRWD-XXXXXXXXXXXX
 */
export function generateRewardSessionId(): string {
  return `MXRWD-${randomBase32(12)}`;
}

/**
 * Formats a 1-based item index inside a batch as 3-digit zero-padded string ("001", "002", ...)
 */
export function formatBatchItemNumber(indexOneBased: number): string {
  return String(Math.max(1, Math.floor(indexOneBased))).padStart(3, '0');
}

/**
 * Generates a prefixed opaque ID for sessions, reservations, ledger rows, audit logs, and events.
 */
export function generatePrefixedId(prefix: string, byteLength: number = 12): string {
  return `${prefix}_${crypto.randomBytes(byteLength).toString('hex')}`;
}
