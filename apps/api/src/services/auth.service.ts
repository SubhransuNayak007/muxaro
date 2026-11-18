/**
 * Project MUXARO - Production Authentication, Session, OAuth 2.0 (PKCE) & MFA Service
 *
 * Security invariants:
 * - Native Node 24 Argon2id (OWASP m=19456, t=2, p=1) with automatic Scrypt (N=16384, r=8, p=1) fallback.
 * - Zero plaintext passwords, session tokens, verification codes, or reset tokens stored in DB.
 * - Constant-time verification (`crypto.timingSafeEqual`) + dummy-hash mitigation against timing attacks.
 * - Anti-enumeration responses on login, registration conflicts, resend verification, and forgot-password.
 * - Google OAuth 2.0 Authorization Code + PKCE (S256) + State + Cookie Binding + Nonce + JWKS RS256 verification.
 * - Strictly reads Google OAuth credentials from process.env (never invents secrets).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DB_PATH,
  getDb,
  getNumericSetting,
  recordAnalyticsEvent,
  runInTransaction,
} from '../db/database.js';
import {
  generateInternalUserId,
  generatePrefixedId,
  generatePublicUserId,
} from './id.service.js';
import { mfaService } from './mfa.service.js';
import { config } from '../config.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const EMAIL_VERIFY_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const EMAIL_VERIFY_MAX_ATTEMPTS = 5;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const LOGIN_ACCOUNT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_ACCOUNT_MAX_FAILURES = 5;
export const LOGIN_IP_MAX_ATTEMPTS = 20;

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ALLOWED_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);

export interface PublicUserSummary {
  id: string;
  publicUserId: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'user';
  tier: 'free' | 'premium';
  accountStatus: string;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  mfaVerified: boolean;
  userAgent: string | null;
  ipPrefix: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface AuthServiceError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown> | null;
  retryAfterSeconds?: number;
}

export function createAuthError(
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown> | null,
  retryAfterSeconds?: number
): AuthServiceError {
  const err = new Error(message) as AuthServiceError;
  err.statusCode = statusCode;
  err.code = code;
  err.details = details ?? null;
  err.retryAfterSeconds = retryAfterSeconds;
  return err;
}

interface RawUserRow {
  id: string;
  public_user_id: string;
  email: string;
  email_verified: number;
  password_hash: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  tier: string;
  account_status: string;
  preferences_json: string | null;
  mfa_enabled: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface GoogleJwk {
  kty: string;
  kid: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

interface GoogleJwksCache {
  keys: GoogleJwk[];
  expiresAtMs: number;
}

let googleJwksCache: GoogleJwksCache | null = null;

// Node 24 native crypto.argon2 type shim for cross-@types/node safety
type NativeArgon2Fn = (
  algorithm: 'argon2d' | 'argon2i' | 'argon2id',
  parameters: {
    message: string | Buffer;
    nonce: Buffer;
    parallelism: number;
    tagLength: number;
    memory: number;
    passes: number;
  },
  callback: (err: Error | null, derivedKey: Buffer) => void
) => void;

function getNativeArgon2(): NativeArgon2Fn | null {
  const candidate = (crypto as unknown as { argon2?: NativeArgon2Fn }).argon2;
  return typeof candidate === 'function' ? candidate : null;
}

export function getActivePasswordHashAlgorithm(): 'argon2id' | 'scrypt' {
  return getNativeArgon2() ? 'argon2id' : 'scrypt';
}

/**
 * Computes SHA-256 hex digest of an opaque token or verification code.
 */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison using SHA-256 fixed-length buffers so length differences never throw.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Masks an IP address to a privacy-preserving prefix (/24 for IPv4, /48 for IPv6).
 */
export function extractIpPrefix(rawIp?: string | null): string {
  if (!rawIp) return 'unknown';
  let ip = rawIp.trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
  }
  if (ip.includes(':')) {
    const parts = ip.split(':').filter((p) => p.length > 0);
    return `${parts.slice(0, 3).join(':')}::/48`;
  }
  return 'unknown';
}

/**
 * Validates and normalizes an email address.
 */
export function normalizeAndValidateEmail(rawEmail: unknown): string {
  if (typeof rawEmail !== 'string') {
    throw createAuthError(400, 'ERR_INVALID_EMAIL', 'Please enter a valid email address.');
  }
  const email = rawEmail.trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw createAuthError(400, 'ERR_INVALID_EMAIL', 'Please enter a valid email address.');
  }
  return email;
}

/**
 * Enforces password strength rules: 8–128 chars and at least 3 character classes.
 */
export function validatePasswordStrength(password: unknown): string {
  if (typeof password !== 'string') {
    throw createAuthError(
      400,
      'ERR_WEAK_PASSWORD',
      'Password must be between 8 and 128 characters and include mixed character types.'
    );
  }
  if (password.length < 8 || password.length > 128) {
    throw createAuthError(
      400,
      'ERR_WEAK_PASSWORD',
      'Password must be between 8 and 128 characters.'
    );
  }

  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^a-zA-Z0-9]/.test(password)) classes++;

  if (classes < 3) {
    throw createAuthError(
      400,
      'ERR_WEAK_PASSWORD',
      'Password must include at least three of: lowercase letters, uppercase letters, numbers, and symbols.'
    );
  }
  return password;
}

/**
 * Sanitizes a user display name (optional).
 */
export function sanitizeDisplayName(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw createAuthError(400, 'ERR_INVALID_DISPLAY_NAME', 'Display name must be a string.');
  }
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.length > 80) {
    throw createAuthError(
      400,
      'ERR_INVALID_DISPLAY_NAME',
      'Display name must be 80 characters or fewer.'
    );
  }
  return cleaned;
}

/**
 * Prevents open redirects by strictly allowing single-slash relative paths.
 */
export function sanitizeReturnTo(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '/';
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 256 ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.includes('\r') ||
    trimmed.includes('\n') ||
    trimmed.includes('\\')
  ) {
    return '/';
  }
  // Reject scheme-like prefixes hidden after slash tricks
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return '/';
  }
  return trimmed;
}

/**
 * Hashes a password with Node 24 native Argon2id (m=19456, t=2, p=1) or Scrypt fallback (N=16384, r=8, p=1).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const argon2Fn = getNativeArgon2();

  if (argon2Fn) {
    const memory = 19456; // 19 MiB (OWASP Argon2id baseline)
    const passes = 2;
    const parallelism = 1;
    const tagLength = 32;

    const derived = await new Promise<Buffer>((resolve, reject) => {
      argon2Fn(
        'argon2id',
        {
          message: password,
          nonce: salt,
          memory,
          passes,
          parallelism,
          tagLength,
        },
        (err, key) => {
          if (err) reject(err);
          else resolve(key);
        }
      );
    });

    return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  // Fallback: hardened scrypt (N=16384, r=8, p=1)
  const N = 16384;
  const r = 8;
  const p = 1;
  const derived = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `$scrypt$N=${N},r=${r},p=${p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

/**
 * Verifies a plaintext password against a stored Argon2id or Scrypt hash in constant time.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || typeof storedHash !== 'string') return false;

  if (storedHash.startsWith('$argon2id$')) {
    const parts = storedHash.split('$');
    // ["", "argon2id", "v=19", "m=...,t=...,p=...", "<salt>", "<hash>"]
    if (parts.length !== 6) return false;
    const paramMap = new Map<string, number>();
    for (const pair of parts[3].split(',')) {
      const [k, v] = pair.split('=');
      if (k && v) paramMap.set(k, Number(v));
    }
    const memory = paramMap.get('m') || 19456;
    const passes = paramMap.get('t') || 2;
    const parallelism = paramMap.get('p') || 1;
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');

    const argon2Fn = getNativeArgon2();
    if (!argon2Fn) return false;

    const derived = await new Promise<Buffer>((resolve, reject) => {
      argon2Fn(
        'argon2id',
        {
          message: password,
          nonce: salt,
          memory,
          passes,
          parallelism,
          tagLength: expected.length,
        },
        (err, key) => {
          if (err) reject(err);
          else resolve(key);
        }
      );
    });

    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }

  if (storedHash.startsWith('$scrypt$')) {
    const parts = storedHash.split('$');
    // ["", "scrypt", "N=...,r=...,p=...", "<salt>", "<hash>"]
    if (parts.length !== 5) return false;
    const paramMap = new Map<string, number>();
    for (const pair of parts[2].split(',')) {
      const [k, v] = pair.split('=');
      if (k && v) paramMap.set(k, Number(v));
    }
    const N = paramMap.get('N') || 16384;
    const r = paramMap.get('r') || 8;
    const p = paramMap.get('p') || 1;
    const salt = Buffer.from(parts[3], 'base64url');
    const expected = Buffer.from(parts[4], 'base64url');
    const derived = crypto.scryptSync(password, salt, expected.length, { N, r, p });
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }

  return false;
}

let cachedDummyHash: string | null = null;
async function runDummyPasswordCheck(password: string): Promise<void> {
  if (!cachedDummyHash) {
    cachedDummyHash = await hashPassword('MuxaroDummyTimingGuard!99');
  }
  await verifyPassword(password, cachedDummyHash);
}

export function isBootstrapAdminEmail(email: string): boolean {
  const configured = process.env.MUXARO_ADMIN_EMAIL || '';
  if (!configured.trim()) return false;
  const list = configured
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export function getGoogleAuthConfig(): {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  return {
    configured: Boolean(clientId && clientSecret && redirectUri),
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function isGoogleAuthConfigured(): boolean {
  return getGoogleAuthConfig().configured;
}

export function mapUserRow(row: RawUserRow, mfaVerified: boolean = false): PublicUserSummary {
  let preferences: Record<string, unknown> = {};
  try {
    preferences = row.preferences_json ? JSON.parse(row.preferences_json) : {};
  } catch {
    preferences = {};
  }

  const normalizedRole = String(row.role || 'USER').toLowerCase() === 'admin' ? 'admin' : 'user';
  const normalizedTier = String(row.tier || 'FREE').toLowerCase() === 'premium' ? 'premium' : 'free';

  return {
    id: row.id,
    publicUserId: row.public_user_id,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: normalizedRole,
    tier: normalizedTier,
    accountStatus: row.account_status,
    mfaEnabled: Boolean(row.mfa_enabled),
    mfaVerified,
    preferences,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function recordSecurityEvent(params: {
  eventType: string;
  severity?: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userId?: string | null;
  publicUserId?: string | null;
  ipPrefix?: string | null;
  endpoint?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
}): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO security_events
       (id, event_type, severity, user_id, public_user_id, ip_prefix, endpoint, request_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generatePrefixedId('sec', 10),
      params.eventType,
      params.severity || 'INFO',
      params.userId ?? null,
      params.publicUserId ?? null,
      params.ipPrefix ?? null,
      params.endpoint ?? null,
      params.requestId ?? null,
      JSON.stringify(params.details || {}),
      new Date().toISOString()
    );
  } catch {
    // Non-blocking audit write
  }
}

/**
 * Local dev/test mail sink ONLY when NODE_ENV !== 'production' and SMTP_HOST is unset.
 * Never logs raw tokens to stdout or returns them in anti-enumeration endpoints.
 */
function writeDevOutbox(entry: Record<string, unknown>): void {
  if (config.env === 'production' || process.env.SMTP_HOST) {
    return;
  }
  try {
    const dbPath = process.env.MUXARO_DB_PATH || DEFAULT_DB_PATH;
    const outboxDir = dbPath === ':memory:' ? path.dirname(DEFAULT_DB_PATH) : path.dirname(dbPath);
    fs.mkdirSync(outboxDir, { recursive: true });
    const outboxPath = path.join(outboxDir, 'dev-outbox.jsonl');
    fs.appendFileSync(outboxPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Best-effort dev outbox
  }
}

function generateUniquePublicUserId(): string {
  const db = getDb();
  const checkStmt = db.prepare('SELECT 1 FROM users WHERE public_user_id = ?');
  for (let i = 0; i < 10; i++) {
    const candidate = generatePublicUserId();
    if (!checkStmt.get(candidate)) {
      return candidate;
    }
  }
  throw createAuthError(500, 'ERR_ID_GENERATION', 'Failed to allocate unique public identifier.');
}

function ensureUserEntitlementRow(userId: string, tier: 'FREE' | 'PREMIUM' = 'FREE'): void {
  const db = getDb();
  const now = new Date().toISOString();
  const baseIndividual = getNumericSetting(
    tier === 'PREMIUM' ? 'premium_individual_limit' : 'base_individual_limit',
    tier === 'PREMIUM' ? 100 : 10,
    db
  );
  const basePlaylist = getNumericSetting(
    tier === 'PREMIUM' ? 'premium_playlist_limit' : 'base_playlist_limit',
    tier === 'PREMIUM' ? 10 : 1,
    db
  );
  const maxConcurrent = getNumericSetting(
    tier === 'PREMIUM' ? 'premium_max_concurrent' : 'free_max_concurrent',
    tier === 'PREMIUM' ? 5 : 2,
    db
  );

  db.prepare(
    `INSERT OR IGNORE INTO entitlements
     (user_id, tier, base_individual_limit, base_playlist_limit, max_concurrent_jobs, extra_credits_balance, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(userId, tier, baseIndividual, basePlaylist, maxConcurrent, now);
}

/**
 * Sliding-window login rate limiter stored atomically in rate_limit_counters.
 */
function checkAndRecordLoginRateLimit(
  bucketKey: string,
  maxHits: number,
  windowMs: number,
  increment: boolean
): { allowed: boolean; retryAfterSeconds: number; hits: number } {
  const db = getDb();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  return runInTransaction((tx) => {
    const row = tx
      .prepare(
        'SELECT hits, window_start_ms, window_ms, blocked_until_ms FROM rate_limit_counters WHERE bucket_key = ?'
      )
      .get(bucketKey) as
      | { hits: number; window_start_ms: number; window_ms: number; blocked_until_ms: number }
      | undefined;

    if (!row || nowMs - row.window_start_ms >= windowMs) {
      const nextHits = increment ? 1 : 0;
      if (increment) {
        tx.prepare(
          `INSERT INTO rate_limit_counters (bucket_key, hits, window_start_ms, window_ms, blocked_until_ms, updated_at)
           VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET
             hits = excluded.hits,
             window_start_ms = excluded.window_start_ms,
             window_ms = excluded.window_ms,
             blocked_until_ms = 0,
             updated_at = excluded.updated_at`
        ).run(bucketKey, nextHits, nowMs, windowMs, nowIso);
      }
      return { allowed: true, retryAfterSeconds: 0, hits: nextHits };
    }

    if (row.blocked_until_ms > nowMs) {
      const retryAfterSeconds = Math.max(1, Math.ceil((row.blocked_until_ms - nowMs) / 1000));
      return { allowed: false, retryAfterSeconds, hits: row.hits };
    }

    if (row.hits >= maxHits) {
      const resetAtMs = row.window_start_ms + windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
      return { allowed: false, retryAfterSeconds, hits: row.hits };
    }

    if (!increment) {
      return { allowed: true, retryAfterSeconds: 0, hits: row.hits };
    }

    const nextHits = row.hits + 1;
    const blockedUntil = nextHits >= maxHits ? row.window_start_ms + windowMs : 0;
    tx.prepare(
      `UPDATE rate_limit_counters
       SET hits = ?, blocked_until_ms = ?, updated_at = ?
       WHERE bucket_key = ?`
    ).run(nextHits, blockedUntil, nowIso, bucketKey);

    if (nextHits > maxHits) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((row.window_start_ms + windowMs - nowMs) / 1000)
      );
      return { allowed: false, retryAfterSeconds, hits: nextHits };
    }

    return { allowed: true, retryAfterSeconds: 0, hits: nextHits };
  }, db);
}

function resetRateLimitBucket(bucketKey: string): void {
  try {
    const db = getDb();
    db.prepare('DELETE FROM rate_limit_counters WHERE bucket_key = ?').run(bucketKey);
  } catch {
    // ignore
  }
}

/**
 * Creates a brand-new server-side session with hashed token + CSRF token.
 */
export function createSession(
  userId: string,
  options?: {
    userAgent?: string | null;
    ipAddress?: string | null;
    mfaVerified?: boolean;
  }
): { session: SessionRecord; sessionToken: string; csrfToken: string } {
  const db = getDb();
  const sessionId = generatePrefixedId('sess', 12);
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(sessionToken);
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + SESSION_TTL_MS).toISOString();
  const ipPrefix = extractIpPrefix(options?.ipAddress);
  const userAgent = options?.userAgent ? String(options.userAgent).slice(0, 256) : null;
  const mfaVerified = options?.mfaVerified ? 1 : 0;

  db.prepare(
    `INSERT INTO user_sessions
     (id, user_id, token_hash, csrf_token, mfa_verified, user_agent, ip_prefix, created_at, last_seen_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    sessionId,
    userId,
    tokenHash,
    csrfToken,
    mfaVerified,
    userAgent,
    ipPrefix,
    nowIso,
    nowIso,
    expiresIso
  );

  return {
    session: {
      id: sessionId,
      userId,
      csrfToken,
      mfaVerified: Boolean(mfaVerified),
      userAgent,
      ipPrefix,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt: expiresIso,
    },
    sessionToken,
    csrfToken,
  };
}

/**
 * Creates a single-use hashed email verification code (6 digits) + URL token (15m expiry, max 5 attempts).
 */
export function createEmailVerification(userId: string, email: string): {
  expiresAt: string;
  deliveryMode: 'smtp' | 'dev-outbox';
} {
  const db = getDb();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + EMAIL_VERIFY_TTL_MS).toISOString();
  const code = String(crypto.randomInt(100000, 1000000));
  const token = crypto.randomBytes(32).toString('base64url');

  runInTransaction((tx) => {
    // Invalidate prior unconsumed verification records for this user
    tx.prepare(
      `UPDATE email_verifications
       SET consumed_at = ?
       WHERE user_id = ? AND consumed_at IS NULL`
    ).run(nowIso, userId);

    tx.prepare(
      `INSERT INTO email_verifications
       (id, user_id, email, token_hash, code_hash, attempts, max_attempts, expires_at, consumed_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)`
    ).run(
      generatePrefixedId('everify', 10),
      userId,
      email,
      hashToken(token),
      hashToken(code),
      EMAIL_VERIFY_MAX_ATTEMPTS,
      expiresIso,
      nowIso
    );
  }, db);

  writeDevOutbox({
    type: 'email_verification',
    email,
    code,
    token,
    expiresAt: expiresIso,
    createdAt: nowIso,
  });

  return {
    expiresAt: expiresIso,
    deliveryMode: process.env.SMTP_HOST ? 'smtp' : 'dev-outbox',
  };
}

/**
 * Registers a new email + password account.
 */
export async function registerWithEmail(params: {
  email: unknown;
  password: unknown;
  displayName?: unknown;
  userAgent?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
}): Promise<{
  user: PublicUserSummary;
  session: SessionRecord;
  sessionToken: string;
  csrfToken: string;
  verificationExpiresAt: string;
  deliveryMode: 'smtp' | 'dev-outbox';
}> {
  const email = normalizeAndValidateEmail(params.email);
  const password = validatePasswordStrength(params.password);
  const displayName = sanitizeDisplayName(params.displayName) || email.split('@')[0].slice(0, 80);
  const ipPrefix = extractIpPrefix(params.ipAddress);

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: string }
    | undefined;

  if (existing) {
    // Perform hash work to keep response timing consistent with registration
    await hashPassword(password);
    recordSecurityEvent({
      eventType: 'REGISTER_DUPLICATE_EMAIL',
      severity: 'INFO',
      ipPrefix,
      endpoint: '/api/v1/auth/register',
      requestId: params.requestId,
    });
    // Generic anti-enumeration error (never explicitly confirms email existence)
    throw createAuthError(
      409,
      'ERR_REGISTRATION_FAILED',
      'Unable to complete registration with those details. If you already have an account, please sign in or reset your password.'
    );
  }

  const passwordHash = await hashPassword(password);
  const internalId = generateInternalUserId();
  const publicUserId = generateUniquePublicUserId();
  const role = isBootstrapAdminEmail(email) ? 'ADMIN' : 'USER';
  const nowIso = new Date().toISOString();

  runInTransaction((tx) => {
    tx.prepare(
      `INSERT INTO users
       (id, public_user_id, email, email_verified, password_hash, display_name, avatar_url, role, tier, account_status, preferences_json, mfa_enabled, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 0, ?, ?, NULL, ?, 'FREE', 'ACTIVE', '{}', 0, ?, ?, NULL)`
    ).run(internalId, publicUserId, email, passwordHash, displayName, role, nowIso, nowIso);
  }, db);

  ensureUserEntitlementRow(internalId, 'FREE');
  const verification = createEmailVerification(internalId, email);
  const { session, sessionToken, csrfToken } = createSession(internalId, {
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    mfaVerified: false,
  });

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(internalId) as unknown as RawUserRow;

  recordAnalyticsEvent('signup_completed', internalId, 'FREE', { method: 'email' });
  recordSecurityEvent({
    eventType: 'USER_REGISTERED',
    severity: 'INFO',
    userId: internalId,
    publicUserId,
    ipPrefix,
    endpoint: '/api/v1/auth/register',
    requestId: params.requestId,
    details: { method: 'email', hashAlgo: getActivePasswordHashAlgorithm() },
  });

  return {
    user: mapUserRow(userRow, false),
    session,
    sessionToken,
    csrfToken,
    verificationExpiresAt: verification.expiresAt,
    deliveryMode: verification.deliveryMode,
  };
}

/**
 * Authenticates an account with email + password (+ optional MFA code), rotating session.
 */
export async function loginWithEmail(params: {
  email: unknown;
  password: unknown;
  mfaCode?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  previousSessionToken?: string | null;
  requestId?: string | null;
}): Promise<{
  user: PublicUserSummary;
  session: SessionRecord;
  sessionToken: string;
  csrfToken: string;
  mfaRequired: boolean;
}> {
  const ipPrefix = extractIpPrefix(params.ipAddress);

  // Per-IP login attempt limit (20 / 15 min)
  const ipKey = `login:ip:${hashToken(params.ipAddress || 'unknown')}`;
  const ipLimit = checkAndRecordLoginRateLimit(
    ipKey,
    LOGIN_IP_MAX_ATTEMPTS,
    LOGIN_ACCOUNT_WINDOW_MS,
    true
  );
  if (!ipLimit.allowed) {
    recordSecurityEvent({
      eventType: 'LOGIN_RATE_LIMITED_IP',
      severity: 'MEDIUM',
      ipPrefix,
      endpoint: '/api/v1/auth/login',
      requestId: params.requestId,
    });
    throw createAuthError(
      429,
      'ERR_RATE_LIMIT_EXCEEDED',
      'Too many sign-in attempts. Please wait a few minutes and try again.',
      null,
      ipLimit.retryAfterSeconds
    );
  }

  let email: string;
  try {
    email = normalizeAndValidateEmail(params.email);
  } catch {
    throw createAuthError(401, 'ERR_INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  const password = typeof params.password === 'string' ? params.password : '';
  if (!password || password.length > 128) {
    throw createAuthError(401, 'ERR_INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  // Per-account failed login limit (5 / 15 min) — check before verifying
  const accountFailKey = `login:acct:${hashToken(email)}`;
  const acctCheck = checkAndRecordLoginRateLimit(
    accountFailKey,
    LOGIN_ACCOUNT_MAX_FAILURES,
    LOGIN_ACCOUNT_WINDOW_MS,
    false
  );
  if (!acctCheck.allowed) {
    recordSecurityEvent({
      eventType: 'LOGIN_BRUTE_FORCE_BLOCKED',
      severity: 'HIGH',
      ipPrefix,
      endpoint: '/api/v1/auth/login',
      requestId: params.requestId,
    });
    throw createAuthError(
      429,
      'ERR_RATE_LIMIT_EXCEEDED',
      'Too many sign-in attempts. Please wait a few minutes and try again.',
      null,
      acctCheck.retryAfterSeconds
    );
  }

  const db = getDb();
  const userRow = db
    .prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL')
    .get(email) as unknown as RawUserRow | undefined;

  if (!userRow || !userRow.password_hash) {
    await runDummyPasswordCheck(password);
    checkAndRecordLoginRateLimit(
      accountFailKey,
      LOGIN_ACCOUNT_MAX_FAILURES,
      LOGIN_ACCOUNT_WINDOW_MS,
      true
    );
    recordSecurityEvent({
      eventType: 'LOGIN_FAILED',
      severity: 'LOW',
      ipPrefix,
      endpoint: '/api/v1/auth/login',
      requestId: params.requestId,
    });
    throw createAuthError(401, 'ERR_INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const passwordValid = await verifyPassword(password, userRow.password_hash);
  if (!passwordValid) {
    const failState = checkAndRecordLoginRateLimit(
      accountFailKey,
      LOGIN_ACCOUNT_MAX_FAILURES,
      LOGIN_ACCOUNT_WINDOW_MS,
      true
    );
    recordSecurityEvent({
      eventType: 'LOGIN_FAILED',
      severity: failState.hits >= LOGIN_ACCOUNT_MAX_FAILURES ? 'HIGH' : 'LOW',
      userId: userRow.id,
      publicUserId: userRow.public_user_id,
      ipPrefix,
      endpoint: '/api/v1/auth/login',
      requestId: params.requestId,
      details: { recentFailures: failState.hits },
    });
    throw createAuthError(401, 'ERR_INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (userRow.account_status !== 'ACTIVE') {
    throw createAuthError(
      403,
      'ERR_ACCOUNT_SUSPENDED',
      'This account is currently suspended. Contact support with your Public User ID.'
    );
  }

  // Optional MFA verification during login
  let mfaVerified = false;
  const mfaEnabled = Boolean(userRow.mfa_enabled);
  if (mfaEnabled && params.mfaCode) {
    const mfaRow = db
      .prepare('SELECT secret, enabled FROM user_mfa WHERE user_id = ?')
      .get(userRow.id) as { secret: string; enabled: number } | undefined;

    if (!mfaRow || !mfaRow.enabled) {
      throw createAuthError(401, 'ERR_INVALID_MFA_CODE', 'Invalid authentication code.');
    }

    const decryptedSecret = mfaService.decryptMfaSecret(mfaRow.secret);
    const check = mfaService.verifyTotpCode(decryptedSecret, params.mfaCode);
    if (!check.valid) {
      recordSecurityEvent({
        eventType: 'MFA_LOGIN_FAILED',
        severity: 'MEDIUM',
        userId: userRow.id,
        publicUserId: userRow.public_user_id,
        ipPrefix,
        endpoint: '/api/v1/auth/login',
        requestId: params.requestId,
      });
      throw createAuthError(401, 'ERR_INVALID_MFA_CODE', 'Invalid authentication code.');
    }
    mfaVerified = true;
  }

  // Clear per-account failure counter on successful password authentication
  resetRateLimitBucket(accountFailKey);

  // Rotate previous session if present (session fixation defense)
  if (params.previousSessionToken) {
    revokeSessionByToken(params.previousSessionToken);
  }

  const { session, sessionToken, csrfToken } = createSession(userRow.id, {
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    mfaVerified,
  });

  recordAnalyticsEvent('login_succeeded', userRow.id, userRow.tier, {
    method: 'email',
    mfaVerified,
  });

  return {
    user: mapUserRow(userRow, mfaVerified),
    session,
    sessionToken,
    csrfToken,
    mfaRequired: mfaEnabled && !mfaVerified,
  };
}

/**
 * Verifies a single-use hashed email verification code or URL token with attempt limits & replay protection.
 */
export function verifyEmail(params: {
  userId?: string | null;
  code?: string;
  token?: string;
  requestId?: string | null;
}): { verified: true; userId: string } {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const rawToken = typeof params.token === 'string' ? params.token.trim() : '';
  const rawCode = typeof params.code === 'string' ? params.code.replace(/\s+/g, '') : '';

  if (!rawToken && !rawCode) {
    throw createAuthError(
      400,
      'ERR_VERIFICATION_REQUIRED',
      'Provide either a 6-digit verification code or verification token.'
    );
  }

  return runInTransaction((tx) => {
    let row:
      | {
          id: string;
          user_id: string;
          token_hash: string;
          code_hash: string;
          attempts: number;
          max_attempts: number;
          expires_at: string;
          consumed_at: string | null;
        }
      | undefined;

    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      row = tx
        .prepare('SELECT * FROM email_verifications WHERE token_hash = ?')
        .get(tokenHash) as typeof row;
    } else {
      if (!params.userId) {
        throw createAuthError(
          401,
          'ERR_UNAUTHORIZED',
          'Sign in to verify your 6-digit code, or submit your full verification token.'
        );
      }
      row = tx
        .prepare(
          `SELECT * FROM email_verifications
           WHERE user_id = ? AND consumed_at IS NULL
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(params.userId) as typeof row;
    }

    if (!row || row.consumed_at !== null || row.expires_at <= nowIso) {
      throw createAuthError(
        400,
        'ERR_VERIFICATION_INVALID_OR_EXPIRED',
        'Verification code or link is invalid or has expired.'
      );
    }

    if (row.attempts >= row.max_attempts) {
      tx.prepare('UPDATE email_verifications SET consumed_at = ? WHERE id = ?').run(nowIso, row.id);
      throw createAuthError(
        429,
        'ERR_VERIFICATION_ATTEMPTS_EXCEEDED',
        'Maximum verification attempts reached. Please request a new verification code.'
      );
    }

    if (rawCode && !rawToken) {
      const candidateHash = hashToken(rawCode);
      if (!timingSafeStringEqual(candidateHash, row.code_hash)) {
        const nextAttempts = row.attempts + 1;
        const consumed = nextAttempts >= row.max_attempts ? nowIso : null;
        tx.prepare(
          'UPDATE email_verifications SET attempts = ?, consumed_at = COALESCE(consumed_at, ?) WHERE id = ?'
        ).run(nextAttempts, consumed, row.id);

        throw createAuthError(
          400,
          'ERR_VERIFICATION_INVALID_OR_EXPIRED',
          'Verification code or link is invalid or has expired.'
        );
      }
    }

    tx.prepare('UPDATE email_verifications SET consumed_at = ? WHERE id = ?').run(nowIso, row.id);
    tx.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(
      nowIso,
      row.user_id
    );

    recordSecurityEvent({
      eventType: 'EMAIL_VERIFIED',
      severity: 'INFO',
      userId: row.user_id,
      endpoint: '/api/v1/auth/verify-email',
      requestId: params.requestId,
    });

    return { verified: true as const, userId: row.user_id };
  }, db);
}

/**
 * Re-issues an email verification code safely (anti-enumeration if unauthenticated).
 */
export function resendEmailVerification(params: {
  userId?: string | null;
  email?: unknown;
}): { message: string; alreadyVerified?: boolean } {
  const db = getDb();

  if (params.userId) {
    const user = db
      .prepare('SELECT id, email, email_verified FROM users WHERE id = ? AND deleted_at IS NULL')
      .get(params.userId) as { id: string; email: string; email_verified: number } | undefined;

    if (!user) {
      throw createAuthError(404, 'ERR_USER_NOT_FOUND', 'Account not found.');
    }
    if (user.email_verified) {
      return { message: 'Your email address is already verified.', alreadyVerified: true };
    }

    createEmailVerification(user.id, user.email);
    return { message: 'A fresh verification code has been issued.' };
  }

  // Unauthenticated path: strict anti-enumeration
  if (typeof params.email === 'string') {
    const email = params.email.trim().toLowerCase();
    const user = db
      .prepare('SELECT id, email, email_verified FROM users WHERE email = ? AND deleted_at IS NULL')
      .get(email) as { id: string; email: string; email_verified: number } | undefined;

    if (user && !user.email_verified) {
      createEmailVerification(user.id, user.email);
    }
  }

  return {
    message:
      'If an unverified account exists for that email address, a new verification code has been issued.',
  };
}

/**
 * Requests a password reset token (30m expiry). Strictly anti-enumeration (always generic 200).
 */
export function requestPasswordReset(params: {
  email: unknown;
  ipAddress?: string | null;
  requestId?: string | null;
}): { message: string } {
  const genericMessage =
    'If an account exists for that email address, password reset instructions have been issued.';

  if (typeof params.email !== 'string') {
    return { message: genericMessage };
  }

  const email = params.email.trim().toLowerCase();
  const db = getDb();
  const user = db
    .prepare(
      `SELECT id, public_user_id, email, account_status FROM users
       WHERE email = ? AND deleted_at IS NULL AND account_status = 'ACTIVE'`
    )
    .get(email) as
    | { id: string; public_user_id: string; email: string; account_status: string }
    | undefined;

  if (user) {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresIso = new Date(nowMs + PASSWORD_RESET_TTL_MS).toISOString();
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);

    runInTransaction((tx) => {
      tx.prepare(
        'UPDATE password_resets SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL'
      ).run(nowIso, user.id);

      tx.prepare(
        `INSERT INTO password_resets (id, user_id, token_hash, attempts, expires_at, consumed_at, created_at)
         VALUES (?, ?, ?, 0, ?, NULL, ?)`
      ).run(generatePrefixedId('prst', 10), user.id, tokenHash, expiresIso, nowIso);
    }, db);

    writeDevOutbox({
      type: 'password_reset',
      email: user.email,
      token: rawToken,
      expiresAt: expiresIso,
      createdAt: nowIso,
    });

    recordSecurityEvent({
      eventType: 'PASSWORD_RESET_REQUESTED',
      severity: 'INFO',
      userId: user.id,
      publicUserId: user.public_user_id,
      ipPrefix: extractIpPrefix(params.ipAddress),
      endpoint: '/api/v1/auth/forgot-password',
      requestId: params.requestId,
    });
  }

  return { message: genericMessage };
}

/**
 * Completes a password reset using a single-use hashed token and revokes ALL active sessions.
 */
export async function resetPassword(params: {
  token: unknown;
  newPassword: unknown;
  ipAddress?: string | null;
  requestId?: string | null;
}): Promise<{ reset: true; sessionsRevoked: number }> {
  if (typeof params.token !== 'string' || !params.token.trim()) {
    throw createAuthError(400, 'ERR_RESET_TOKEN_INVALID', 'Password reset token is invalid or expired.');
  }
  const newPassword = validatePasswordStrength(params.newPassword);
  const tokenHash = hashToken(params.token.trim());
  const db = getDb();
  const nowIso = new Date().toISOString();

  const existing = db
    .prepare('SELECT id, user_id, expires_at, consumed_at FROM password_resets WHERE token_hash = ?')
    .get(tokenHash) as
    | { id: string; user_id: string; expires_at: string; consumed_at: string | null }
    | undefined;

  if (!existing || existing.consumed_at !== null || existing.expires_at <= nowIso) {
    throw createAuthError(
      400,
      'ERR_RESET_TOKEN_INVALID',
      'Password reset token is invalid or expired.'
    );
  }

  const newHash = await hashPassword(newPassword);

  const sessionsRevoked = runInTransaction((tx) => {
    const fresh = tx
      .prepare('SELECT consumed_at, expires_at FROM password_resets WHERE id = ?')
      .get(existing.id) as { consumed_at: string | null; expires_at: string } | undefined;

    if (!fresh || fresh.consumed_at !== null || fresh.expires_at <= nowIso) {
      throw createAuthError(
        400,
        'ERR_RESET_TOKEN_INVALID',
        'Password reset token is invalid or expired.'
      );
    }

    tx.prepare('UPDATE password_resets SET consumed_at = ? WHERE id = ?').run(nowIso, existing.id);
    tx.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      newHash,
      nowIso,
      existing.user_id
    );
    const revokeRes = tx
      .prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(nowIso, existing.user_id);

    return Number(revokeRes.changes || 0);
  }, db);

  recordSecurityEvent({
    eventType: 'PASSWORD_RESET_COMPLETED',
    severity: 'MEDIUM',
    userId: existing.user_id,
    ipPrefix: extractIpPrefix(params.ipAddress),
    endpoint: '/api/v1/auth/reset-password',
    requestId: params.requestId,
    details: { sessionsRevoked },
  });

  return { reset: true, sessionsRevoked };
}

/**
 * Revokes a session by raw token.
 */
export function revokeSessionByToken(rawToken: string): boolean {
  if (!rawToken) return false;
  const db = getDb();
  const res = db
    .prepare('UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), hashToken(rawToken));
  return Number(res.changes || 0) > 0;
}

/**
 * Revokes all active sessions for a user.
 */
export function revokeAllSessions(userId: string, requestId?: string | null): number {
  const db = getDb();
  const res = db
    .prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), userId);
  const count = Number(res.changes || 0);

  recordSecurityEvent({
    eventType: 'SESSIONS_REVOKED_ALL',
    severity: 'INFO',
    userId,
    endpoint: '/api/v1/auth/logout-all',
    requestId,
    details: { count },
  });

  return count;
}

/**
 * Lists active sessions for a user (never returns token hashes or CSRF secrets).
 */
export function listActiveSessions(userId: string, currentSessionId?: string | null) {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT id, user_agent, ip_prefix, mfa_verified, created_at, last_seen_at, expires_at
       FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY last_seen_at DESC`
    )
    .all(userId, nowIso) as Array<{
    id: string;
    user_agent: string | null;
    ip_prefix: string | null;
    mfa_verified: number;
    created_at: string;
    last_seen_at: string;
    expires_at: string;
  }>;

  return rows.map((r) => ({
    sessionId: r.id,
    current: Boolean(currentSessionId && r.id === currentSessionId),
    userAgent: r.user_agent,
    ipPrefix: r.ip_prefix,
    mfaVerified: Boolean(r.mfa_verified),
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
  }));
}

/**
 * Revokes a single session with strict ownership enforcement (blocks IDOR).
 */
export function revokeSessionById(params: {
  sessionId: string;
  ownerUserId: string;
  ipAddress?: string | null;
  requestId?: string | null;
}): { revoked: true; wasCurrent?: boolean } {
  const db = getDb();
  const row = db
    .prepare('SELECT id, user_id, revoked_at FROM user_sessions WHERE id = ?')
    .get(params.sessionId) as { id: string; user_id: string; revoked_at: string | null } | undefined;

  if (!row) {
    throw createAuthError(404, 'ERR_SESSION_NOT_FOUND', 'Session not found.');
  }

  if (row.user_id !== params.ownerUserId) {
    recordSecurityEvent({
      eventType: 'IDOR_ATTEMPT',
      severity: 'HIGH',
      userId: params.ownerUserId,
      ipPrefix: extractIpPrefix(params.ipAddress),
      endpoint: `/api/v1/me/sessions/${params.sessionId}`,
      requestId: params.requestId,
      details: { resource: 'user_session' },
    });
    throw createAuthError(403, 'ERR_FORBIDDEN', 'You do not have permission to manage this session.');
  }

  if (!row.revoked_at) {
    db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ?').run(
      new Date().toISOString(),
      params.sessionId,
      params.ownerUserId
    );
  }

  return { revoked: true };
}

/**
 * Starts RFC 6238 TOTP MFA enrollment (pending verification).
 */
export function setupMfa(userId: string): {
  secret: string;
  otpauthUri: string;
  issuer: string;
  digits: number;
  periodSeconds: number;
} {
  const db = getDb();
  const user = db
    .prepare('SELECT email FROM users WHERE id = ? AND deleted_at IS NULL')
    .get(userId) as { email: string } | undefined;

  if (!user) {
    throw createAuthError(404, 'ERR_USER_NOT_FOUND', 'Account not found.');
  }

  const secret = mfaService.generateTotpSecret(20);
  const encryptedSecret = mfaService.encryptMfaSecret(secret);
  const otpauthUri = mfaService.generateTotpUri({ secret, email: user.email, issuer: 'MUXARO' });
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO user_mfa (user_id, secret, enabled, backup_codes_json, verified_at, created_at, updated_at)
     VALUES (?, ?, 0, '[]', NULL, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       secret = excluded.secret,
       enabled = 0,
       verified_at = NULL,
       updated_at = excluded.updated_at`
  ).run(userId, encryptedSecret, nowIso, nowIso);

  return {
    secret,
    otpauthUri,
    issuer: 'MUXARO',
    digits: 6,
    periodSeconds: 30,
  };
}

/**
 * Verifies a TOTP code to finalize MFA enrollment or elevate the current session to mfa_verified=1.
 */
export function verifyMfa(params: {
  userId: string;
  sessionId: string;
  code: string;
  ipAddress?: string | null;
  requestId?: string | null;
}): { mfaEnabled: true; mfaVerified: true } {
  const db = getDb();
  const mfaRow = db
    .prepare('SELECT secret, enabled FROM user_mfa WHERE user_id = ?')
    .get(params.userId) as { secret: string; enabled: number } | undefined;

  if (!mfaRow) {
    throw createAuthError(400, 'ERR_MFA_NOT_CONFIGURED', 'Set up two-factor authentication first.');
  }

  const secret = mfaService.decryptMfaSecret(mfaRow.secret);
  const result = mfaService.verifyTotpCode(secret, params.code);
  if (!result.valid) {
    recordSecurityEvent({
      eventType: 'MFA_VERIFY_FAILED',
      severity: 'MEDIUM',
      userId: params.userId,
      ipPrefix: extractIpPrefix(params.ipAddress),
      endpoint: '/api/v1/auth/mfa/verify',
      requestId: params.requestId,
    });
    throw createAuthError(401, 'ERR_INVALID_MFA_CODE', 'Invalid authentication code.');
  }

  const nowIso = new Date().toISOString();
  runInTransaction((tx) => {
    tx.prepare(
      'UPDATE user_mfa SET enabled = 1, verified_at = ?, updated_at = ? WHERE user_id = ?'
    ).run(nowIso, nowIso, params.userId);
    tx.prepare('UPDATE users SET mfa_enabled = 1, updated_at = ? WHERE id = ?').run(
      nowIso,
      params.userId
    );
    tx.prepare('UPDATE user_sessions SET mfa_verified = 1 WHERE id = ? AND user_id = ?').run(
      params.sessionId,
      params.userId
    );
  }, db);

  recordSecurityEvent({
    eventType: 'MFA_VERIFIED',
    severity: 'INFO',
    userId: params.userId,
    ipPrefix: extractIpPrefix(params.ipAddress),
    endpoint: '/api/v1/auth/mfa/verify',
    requestId: params.requestId,
  });

  return { mfaEnabled: true, mfaVerified: true };
}

/**
 * Disables TOTP MFA after verifying a valid current TOTP code.
 */
export function disableMfa(params: {
  userId: string;
  code: string;
  ipAddress?: string | null;
  requestId?: string | null;
}): { mfaEnabled: false; mfaVerified: false } {
  const db = getDb();
  const mfaRow = db
    .prepare('SELECT secret, enabled FROM user_mfa WHERE user_id = ?')
    .get(params.userId) as { secret: string; enabled: number } | undefined;

  if (!mfaRow || !mfaRow.enabled) {
    throw createAuthError(400, 'ERR_MFA_NOT_ENABLED', 'Two-factor authentication is not enabled.');
  }

  const secret = mfaService.decryptMfaSecret(mfaRow.secret);
  const result = mfaService.verifyTotpCode(secret, params.code);
  if (!result.valid) {
    recordSecurityEvent({
      eventType: 'MFA_DISABLE_FAILED',
      severity: 'MEDIUM',
      userId: params.userId,
      ipPrefix: extractIpPrefix(params.ipAddress),
      endpoint: '/api/v1/auth/mfa/disable',
      requestId: params.requestId,
    });
    throw createAuthError(401, 'ERR_INVALID_MFA_CODE', 'Invalid authentication code.');
  }

  const nowIso = new Date().toISOString();
  runInTransaction((tx) => {
    tx.prepare('UPDATE user_mfa SET enabled = 0, updated_at = ? WHERE user_id = ?').run(
      nowIso,
      params.userId
    );
    tx.prepare('UPDATE users SET mfa_enabled = 0, updated_at = ? WHERE id = ?').run(
      nowIso,
      params.userId
    );
    tx.prepare('UPDATE user_sessions SET mfa_verified = 0 WHERE user_id = ?').run(params.userId);
  }, db);

  recordSecurityEvent({
    eventType: 'MFA_DISABLED',
    severity: 'MEDIUM',
    userId: params.userId,
    ipPrefix: extractIpPrefix(params.ipAddress),
    endpoint: '/api/v1/auth/mfa/disable',
    requestId: params.requestId,
  });

  return { mfaEnabled: false, mfaVerified: false };
}

/**
 * Initiates Google OAuth 2.0 Authorization Code + PKCE (S256) + State + Nonce flow.
 */
export function startGoogleOAuth(params: {
  returnTo?: string | null;
  ipAddress?: string | null;
}): {
  authorizationUrl: string;
  state: string;
  stateCookieValue: string;
} {
  const gConfig = getGoogleAuthConfig();
  if (!gConfig.configured) {
    throw createAuthError(
      503,
      'ERR_GOOGLE_AUTH_NOT_CONFIGURED',
      'Google sign-in is not configured on this server.'
    );
  }

  const safeReturnTo = sanitizeReturnTo(params.returnTo);
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier, 'utf8')
    .digest('base64url');

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + OAUTH_STATE_TTL_MS).toISOString();
  const db = getDb();

  // Purge expired states opportunistically
  db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(nowIso);

  db.prepare(
    `INSERT INTO oauth_states (state, nonce, code_verifier, return_to, ip_prefix, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    state,
    nonce,
    codeVerifier,
    safeReturnTo,
    extractIpPrefix(params.ipAddress),
    expiresIso,
    nowIso
  );

  const authParams = new URLSearchParams({
    client_id: gConfig.clientId,
    redirect_uri: gConfig.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  return {
    authorizationUrl: `${GOOGLE_AUTH_ENDPOINT}?${authParams.toString()}`,
    state,
    stateCookieValue: hashToken(state),
  };
}

async function fetchGoogleJwks(forceRefresh: boolean = false): Promise<GoogleJwk[]> {
  if (!forceRefresh && googleJwksCache && googleJwksCache.expiresAtMs > Date.now()) {
    return googleJwksCache.keys;
  }

  const res = await fetch(GOOGLE_JWKS_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw createAuthError(502, 'ERR_OAUTH_JWKS_FETCH', 'Unable to verify Google identity keys.');
  }

  const data = (await res.json()) as { keys?: GoogleJwk[] };
  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw createAuthError(502, 'ERR_OAUTH_JWKS_INVALID', 'Invalid JWKS response from Google.');
  }

  // Respect Cache-Control max-age (default 1 hour)
  let maxAgeSec = 3600;
  const cacheControl = res.headers.get('cache-control') || '';
  const match = /max-age=(\d+)/i.exec(cacheControl);
  if (match) {
    maxAgeSec = Math.max(60, Math.min(86400, parseInt(match[1], 10)));
  }

  googleJwksCache = {
    keys: data.keys,
    expiresAtMs: Date.now() + maxAgeSec * 1000,
  };
  return data.keys;
}

export interface VerifiedGoogleClaims {
  sub: string;
  email: string;
  email_verified: true;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  exp: number;
  nonce: string;
}

/**
 * Cryptographically verifies a Google OpenID Connect ID Token JWT (RS256 against Google JWKS + claims).
 */
export async function verifyGoogleIdToken(
  idToken: string,
  expectedNonce: string,
  expectedClientId: string,
  jwksOverride?: GoogleJwk[]
): Promise<VerifiedGoogleClaims> {
  const segments = idToken.split('.');
  if (segments.length !== 3) {
    throw createAuthError(401, 'ERR_OAUTH_INVALID_ID_TOKEN', 'Malformed Google ID token.');
  }

  const [headerB64, payloadB64, signatureB64] = segments;
  let header: { alg?: string; kid?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw createAuthError(401, 'ERR_OAUTH_INVALID_ID_TOKEN', 'Unable to decode Google ID token.');
  }

  // Strictly enforce RS256 to block alg=none and symmetric HS256 confusion attacks
  if (header.alg !== 'RS256' || !header.kid) {
    throw createAuthError(401, 'ERR_OAUTH_INVALID_ALG', 'Unsupported Google ID token algorithm.');
  }

  let keys = jwksOverride ?? (await fetchGoogleJwks(false));
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk && !jwksOverride) {
    keys = await fetchGoogleJwks(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) {
    throw createAuthError(401, 'ERR_OAUTH_UNKNOWN_KEY', 'Google signing key not recognized.');
  }

  const publicKey = crypto.createPublicKey({
    key: jwk as unknown as crypto.JsonWebKeyInput['key'],
    format: 'jwk',
  });
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = Buffer.from(signatureB64, 'base64url');
  const sigValid = crypto.verify('RSA-SHA256', signingInput, publicKey, signature);
  if (!sigValid) {
    throw createAuthError(401, 'ERR_OAUTH_BAD_SIGNATURE', 'Invalid Google ID token signature.');
  }

  const iss = String(payload.iss || '');
  if (!GOOGLE_ALLOWED_ISSUERS.has(iss)) {
    throw createAuthError(401, 'ERR_OAUTH_BAD_ISSUER', 'Invalid Google ID token issuer.');
  }

  const aud = String(payload.aud || '');
  if (!timingSafeStringEqual(aud, expectedClientId)) {
    throw createAuthError(401, 'ERR_OAUTH_BAD_AUDIENCE', 'Invalid Google ID token audience.');
  }

  const exp = Number(payload.exp || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(exp) || exp + 60 < nowSec) {
    throw createAuthError(401, 'ERR_OAUTH_TOKEN_EXPIRED', 'Google ID token has expired.');
  }

  const nonce = String(payload.nonce || '');
  if (!nonce || !timingSafeStringEqual(nonce, expectedNonce)) {
    throw createAuthError(401, 'ERR_OAUTH_NONCE_MISMATCH', 'Google ID token nonce mismatch.');
  }

  if (payload.email_verified !== true) {
    throw createAuthError(
      403,
      'ERR_OAUTH_EMAIL_UNVERIFIED',
      'Your Google account email must be verified to sign in.'
    );
  }

  const sub = String(payload.sub || '').trim();
  const email = normalizeAndValidateEmail(payload.email);
  if (!sub) {
    throw createAuthError(401, 'ERR_OAUTH_MISSING_SUBJECT', 'Google ID token is missing subject.');
  }

  return {
    sub,
    email,
    email_verified: true,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 80) : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture.slice(0, 512) : undefined,
    iss,
    aud,
    exp,
    nonce,
  };
}

/**
 * Completes the Google OAuth 2.0 callback: validates state + cookie binding, exchanges code with PKCE,
 * verifies ID token signature + claims, links/creates user, and issues a rotated session.
 */
export async function completeGoogleOAuth(params: {
  code?: string;
  state?: string;
  cookieStateHash?: string;
  previousSessionToken?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
}): Promise<{
  user: PublicUserSummary;
  session: SessionRecord;
  sessionToken: string;
  csrfToken: string;
  returnTo: string;
}> {
  const gConfig = getGoogleAuthConfig();
  if (!gConfig.configured) {
    throw createAuthError(
      503,
      'ERR_GOOGLE_AUTH_NOT_CONFIGURED',
      'Google sign-in is not configured on this server.'
    );
  }

  const ipPrefix = extractIpPrefix(params.ipAddress);

  if (!params.code || !params.state || !params.cookieStateHash) {
    recordSecurityEvent({
      eventType: 'OAUTH_STATE_MISSING',
      severity: 'MEDIUM',
      ipPrefix,
      endpoint: '/api/v1/auth/google/callback',
      requestId: params.requestId,
    });
    throw createAuthError(400, 'ERR_OAUTH_STATE_INVALID', 'Invalid or expired OAuth sign-in state.');
  }

  const expectedHash = hashToken(params.state);
  if (!timingSafeStringEqual(expectedHash, params.cookieStateHash)) {
    recordSecurityEvent({
      eventType: 'OAUTH_STATE_COOKIE_MISMATCH',
      severity: 'HIGH',
      ipPrefix,
      endpoint: '/api/v1/auth/google/callback',
      requestId: params.requestId,
    });
    throw createAuthError(400, 'ERR_OAUTH_STATE_INVALID', 'Invalid or expired OAuth sign-in state.');
  }

  const db = getDb();
  const nowIso = new Date().toISOString();

  // Atomically consume single-use state
  const storedState = runInTransaction((tx) => {
    const row = tx
      .prepare(
        `SELECT state, nonce, code_verifier, return_to, expires_at, consumed_at
         FROM oauth_states WHERE state = ?`
      )
      .get(params.state!) as
      | {
          state: string;
          nonce: string;
          code_verifier: string;
          return_to: string;
          expires_at: string;
          consumed_at: string | null;
        }
      | undefined;

    if (!row || row.consumed_at !== null || row.expires_at <= nowIso) {
      return null;
    }

    tx.prepare('UPDATE oauth_states SET consumed_at = ? WHERE state = ?').run(nowIso, row.state);
    return row;
  }, db);

  if (!storedState) {
    recordSecurityEvent({
      eventType: 'OAUTH_STATE_REPLAY_OR_EXPIRED',
      severity: 'HIGH',
      ipPrefix,
      endpoint: '/api/v1/auth/google/callback',
      requestId: params.requestId,
    });
    throw createAuthError(400, 'ERR_OAUTH_STATE_INVALID', 'Invalid or expired OAuth sign-in state.');
  }

  // Exchange authorization code with Google token endpoint using PKCE code_verifier
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: gConfig.clientId,
    client_secret: gConfig.clientSecret,
    redirect_uri: gConfig.redirectUri,
    code_verifier: storedState.code_verifier,
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    recordSecurityEvent({
      eventType: 'OAUTH_TOKEN_EXCHANGE_FAILED',
      severity: 'MEDIUM',
      ipPrefix,
      endpoint: '/api/v1/auth/google/callback',
      requestId: params.requestId,
      details: { status: tokenRes.status },
    });
    throw createAuthError(401, 'ERR_OAUTH_TOKEN_EXCHANGE', 'Google authorization exchange failed.');
  }

  const tokenJson = (await tokenRes.json()) as { id_token?: string };
  if (!tokenJson.id_token) {
    throw createAuthError(401, 'ERR_OAUTH_MISSING_ID_TOKEN', 'Google response did not include an ID token.');
  }

  const claims = await verifyGoogleIdToken(tokenJson.id_token, storedState.nonce, gConfig.clientId);

  // Link or create account transactionally
  const { userId, isNewUser } = runInTransaction((tx) => {
    const oauthLink = tx
      .prepare(
        `SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_subject = ?`
      )
      .get(claims.sub) as { user_id: string } | undefined;

    if (oauthLink) {
      const linkedUser = tx
        .prepare('SELECT id, account_status, deleted_at FROM users WHERE id = ?')
        .get(oauthLink.user_id) as
        | { id: string; account_status: string; deleted_at: string | null }
        | undefined;

      if (!linkedUser || linkedUser.deleted_at) {
        throw createAuthError(403, 'ERR_ACCOUNT_DELETED', 'This account is no longer active.');
      }
      if (linkedUser.account_status !== 'ACTIVE') {
        throw createAuthError(403, 'ERR_ACCOUNT_SUSPENDED', 'This account is currently suspended.');
      }

      tx.prepare(
        `UPDATE oauth_accounts
         SET email = ?, email_verified = 1, profile_json = ?, updated_at = ?
         WHERE provider = 'google' AND provider_subject = ?`
      ).run(
        claims.email,
        JSON.stringify({ name: claims.name, picture: claims.picture }),
        nowIso,
        claims.sub
      );

      return { userId: linkedUser.id, isNewUser: false };
    }

    // Check existing account by verified email
    const existingByEmail = tx
      .prepare('SELECT id, account_status, avatar_url, deleted_at FROM users WHERE email = ?')
      .get(claims.email) as
      | { id: string; account_status: string; avatar_url: string | null; deleted_at: string | null }
      | undefined;

    if (existingByEmail) {
      if (existingByEmail.deleted_at) {
        throw createAuthError(403, 'ERR_ACCOUNT_DELETED', 'This account is no longer active.');
      }
      if (existingByEmail.account_status !== 'ACTIVE') {
        throw createAuthError(403, 'ERR_ACCOUNT_SUSPENDED', 'This account is currently suspended.');
      }

      tx.prepare(
        `INSERT INTO oauth_accounts
         (id, user_id, provider, provider_subject, email, email_verified, profile_json, created_at, updated_at)
         VALUES (?, ?, 'google', ?, ?, 1, ?, ?, ?)`
      ).run(
        generatePrefixedId('oauth', 10),
        existingByEmail.id,
        claims.sub,
        claims.email,
        JSON.stringify({ name: claims.name, picture: claims.picture }),
        nowIso,
        nowIso
      );

      tx.prepare(
        `UPDATE users
         SET email_verified = 1,
             avatar_url = COALESCE(avatar_url, ?),
             updated_at = ?
         WHERE id = ?`
      ).run(claims.picture ?? null, nowIso, existingByEmail.id);

      return { userId: existingByEmail.id, isNewUser: false };
    }

    // Create brand-new user account
    const newId = generateInternalUserId();
    const publicId = generateUniquePublicUserId();
    const role = isBootstrapAdminEmail(claims.email) ? 'ADMIN' : 'USER';
    const displayName = sanitizeDisplayName(claims.name) || claims.email.split('@')[0].slice(0, 80);

    tx.prepare(
      `INSERT INTO users
       (id, public_user_id, email, email_verified, password_hash, display_name, avatar_url, role, tier, account_status, preferences_json, mfa_enabled, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 1, NULL, ?, ?, ?, 'FREE', 'ACTIVE', '{}', 0, ?, ?, NULL)`
    ).run(
      newId,
      publicId,
      claims.email,
      displayName,
      claims.picture ?? null,
      role,
      nowIso,
      nowIso
    );

    tx.prepare(
      `INSERT INTO oauth_accounts
       (id, user_id, provider, provider_subject, email, email_verified, profile_json, created_at, updated_at)
       VALUES (?, ?, 'google', ?, ?, 1, ?, ?, ?)`
    ).run(
      generatePrefixedId('oauth', 10),
      newId,
      claims.sub,
      claims.email,
      JSON.stringify({ name: claims.name, picture: claims.picture }),
      nowIso,
      nowIso
    );

    return { userId: newId, isNewUser: true };
  }, db);

  if (isNewUser) {
    ensureUserEntitlementRow(userId, 'FREE');
  }

  if (params.previousSessionToken) {
    revokeSessionByToken(params.previousSessionToken);
  }

  const { session, sessionToken, csrfToken } = createSession(userId, {
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    mfaVerified: false,
  });

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as RawUserRow;

  recordAnalyticsEvent(isNewUser ? 'signup_completed' : 'login_succeeded', userId, userRow.tier, {
    method: 'google',
  });

  return {
    user: mapUserRow(userRow, false),
    session,
    sessionToken,
    csrfToken,
    returnTo: sanitizeReturnTo(storedState.return_to),
  };
}

/**
 * Fetches full profile + live account counts for GET /api/v1/me.
 */
export function getUserProfile(userId: string, mfaVerified: boolean) {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL')
    .get(userId) as unknown as RawUserRow | undefined;

  if (!row) {
    throw createAuthError(404, 'ERR_USER_NOT_FOUND', 'Account not found.');
  }

  const nowIso = new Date().toISOString();
  const activeSessionsRow = db
    .prepare(
      'SELECT COUNT(*) AS cnt FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?'
    )
    .get(userId, nowIso) as { cnt: number };

  const jobsSummary = db
    .prepare(
      `SELECT
         COUNT(*) AS totalJobs,
         SUM(CASE WHEN status IN ('QUEUED', 'PROCESSING', 'VERIFYING') THEN 1 ELSE 0 END) AS activeJobs,
         SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS completedJobs
       FROM processing_jobs WHERE owner_user_id = ?`
    )
    .get(userId) as { totalJobs: number; activeJobs: number | null; completedJobs: number | null };

  const oauthRows = db
    .prepare('SELECT provider, created_at FROM oauth_accounts WHERE user_id = ?')
    .all(userId) as Array<{ provider: string; created_at: string }>;

  return {
    ...mapUserRow(row, mfaVerified),
    activeSessionsCount: Number(activeSessionsRow?.cnt || 0),
    stats: {
      totalJobs: Number(jobsSummary?.totalJobs || 0),
      activeJobs: Number(jobsSummary?.activeJobs || 0),
      completedJobs: Number(jobsSummary?.completedJobs || 0),
    },
    linkedProviders: oauthRows.map((o) => o.provider),
  };
}

/**
 * Updates displayName and/or user preferences for PATCH /api/v1/me.
 */
export function updateUserProfile(
  userId: string,
  updates: { displayName?: unknown; preferences?: unknown },
  mfaVerified: boolean
): PublicUserSummary {
  const db = getDb();
  const current = db
    .prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL')
    .get(userId) as unknown as RawUserRow | undefined;

  if (!current) {
    throw createAuthError(404, 'ERR_USER_NOT_FOUND', 'Account not found.');
  }

  let nextDisplayName = current.display_name;
  if (updates.displayName !== undefined) {
    nextDisplayName = sanitizeDisplayName(updates.displayName);
  }

  let nextPrefsJson = current.preferences_json || '{}';
  if (updates.preferences !== undefined) {
    if (
      typeof updates.preferences !== 'object' ||
      updates.preferences === null ||
      Array.isArray(updates.preferences)
    ) {
      throw createAuthError(400, 'ERR_INVALID_PREFERENCES', 'Preferences must be a JSON object.');
    }
    const existingPrefs = (() => {
      try {
        return current.preferences_json ? JSON.parse(current.preferences_json) : {};
      } catch {
        return {};
      }
    })();
    const merged = { ...existingPrefs, ...(updates.preferences as Record<string, unknown>) };
    const serialized = JSON.stringify(merged);
    if (serialized.length > 4096) {
      throw createAuthError(400, 'ERR_INVALID_PREFERENCES', 'Preferences payload is too large.');
    }
    nextPrefsJson = serialized;
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE users SET display_name = ?, preferences_json = ?, updated_at = ? WHERE id = ?`
  ).run(nextDisplayName, nextPrefsJson, nowIso, userId);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as RawUserRow;
  return mapUserRow(updated, mfaVerified);
}

/**
 * Soft-deletes a user account, anonymizes PII email to release uniqueness, and revokes all sessions.
 */
export function softDeleteUser(
  userId: string,
  ipAddress?: string | null,
  requestId?: string | null
): { deleted: true; sessionsRevoked: number } {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const sessionsRevoked = runInTransaction((tx) => {
    const user = tx
      .prepare('SELECT id, public_user_id FROM users WHERE id = ? AND deleted_at IS NULL')
      .get(userId) as { id: string; public_user_id: string } | undefined;

    if (!user) {
      throw createAuthError(404, 'ERR_USER_NOT_FOUND', 'Account not found.');
    }

    const anonymizedEmail = `deleted+${userId}@deleted.muxaro.invalid`;
    tx.prepare(
      `UPDATE users
       SET account_status = 'DELETED',
           deleted_at = ?,
           email = ?,
           password_hash = NULL,
           display_name = 'Deleted User',
           avatar_url = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run(nowIso, anonymizedEmail, nowIso, userId);

    const revokeRes = tx
      .prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(nowIso, userId);

    return Number(revokeRes.changes || 0);
  }, db);

  recordSecurityEvent({
    eventType: 'ACCOUNT_DELETED',
    severity: 'MEDIUM',
    userId,
    ipPrefix: extractIpPrefix(ipAddress),
    endpoint: '/api/v1/me',
    requestId,
    details: { sessionsRevoked },
  });

  return { deleted: true, sessionsRevoked };
}

export const authService = {
  hashToken,
  timingSafeStringEqual,
  extractIpPrefix,
  normalizeAndValidateEmail,
  validatePasswordStrength,
  sanitizeDisplayName,
  sanitizeReturnTo,
  hashPassword,
  verifyPassword,
  getActivePasswordHashAlgorithm,
  isGoogleAuthConfigured,
  getGoogleAuthConfig,
  isBootstrapAdminEmail,
  createSession,
  createEmailVerification,
  registerWithEmail,
  loginWithEmail,
  verifyEmail,
  resendEmailVerification,
  requestPasswordReset,
  resetPassword,
  revokeSessionByToken,
  revokeAllSessions,
  listActiveSessions,
  revokeSessionById,
  setupMfa,
  verifyMfa,
  disableMfa,
  startGoogleOAuth,
  completeGoogleOAuth,
  verifyGoogleIdToken,
  getUserProfile,
  updateUserProfile,
  softDeleteUser,
  recordSecurityEvent,
};
