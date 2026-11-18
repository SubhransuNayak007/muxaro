/**
 * Project MUXARO - Multi-Layer Rate Limiting, Abuse Prevention & Redacted Security Telemetry Service
 *
 * Completely separate from daily user quotas (`entitlements.service.ts`).
 * Implements:
 * - Hybrid Sliding-Window + Token-Bucket rate limiting across account ID, IP, session ID, endpoint, and active claims
 * - Atomic SQLite persistence (`rate_limit_counters`) with pluggable Redis backend interface (`REDIS_URL`)
 * - Progressive login failure backoff (5 / 15 min / account) — NEVER permanent DoS lockout
 * - Job & batch polling (`GET /jobs/:id`, `GET /batches/:id`) explicitly exempted from tight throttling
 * - Structured redacted `security_events` persistence (never logs tokens, passwords, or private URLs)
 */

import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDb, runInTransaction } from '../db/database.js';
import { generatePrefixedId } from './id.service.js';
import { config } from '../config.js';

export type SecurityEventType =
  | 'BRUTE_FORCE'
  | 'RATE_LIMIT_SPIKE'
  | 'IDOR_ATTEMPT'
  | 'REWARD_REPLAY'
  | 'DUPLICATE_FLOOD'
  | 'CSRF_VIOLATION'
  | 'UNAUTHORIZED_ADMIN'
  | 'MFA_FAILURE'
  | 'SSRF_BLOCKED'
  | 'SUSPICIOUS_ACTIVITY';

export type SecuritySeverity = 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';

export type RateLimitPolicyName =
  | 'login_account'
  | 'login_ip'
  | 'register_ip'
  | 'auth_recovery'
  | 'media_inspect'
  | 'job_create'
  | 'upload_init'
  | 'job_cancel'
  | 'reward_claim'
  | 'admin_api';

export interface RateLimitPolicy {
  name: RateLimitPolicyName;
  limit: number;
  windowSeconds: number;
  burstCapacity: number;
  dimension: 'account' | 'ip' | 'session' | 'active_claim';
  progressiveDelaysSeconds?: readonly number[];
  description: string;
}

export const RATE_LIMIT_POLICIES: Readonly<Record<RateLimitPolicyName, RateLimitPolicy>> = {
  login_account: {
    name: 'login_account',
    limit: 5,
    windowSeconds: 900, // 15 minutes
    burstCapacity: 5,
    dimension: 'account',
    progressiveDelaysSeconds: [0, 1, 2, 4, 8, 15],
    description: 'Failed login attempts per account (5 / 15 min) with progressive delay, never permanent lockout',
  },
  login_ip: {
    name: 'login_ip',
    limit: 20,
    windowSeconds: 900, // 15 minutes
    burstCapacity: 20,
    dimension: 'ip',
    description: 'Login requests per client IP (20 / 15 min)',
  },
  register_ip: {
    name: 'register_ip',
    limit: 10,
    windowSeconds: 900, // 15 minutes
    burstCapacity: 10,
    dimension: 'ip',
    description: 'Registration requests per client IP (10 / 15 min)',
  },
  auth_recovery: {
    name: 'auth_recovery',
    limit: 10,
    windowSeconds: 900, // 15 minutes
    burstCapacity: 10,
    dimension: 'ip',
    description: 'Password reset and email verification requests per IP (10 / 15 min)',
  },
  media_inspect: {
    name: 'media_inspect',
    limit: 10,
    windowSeconds: 60, // 1 minute
    burstCapacity: 10,
    dimension: 'account',
    description: 'Media URL analysis requests (10 / min / account)',
  },
  job_create: {
    name: 'job_create',
    limit: 5,
    windowSeconds: 60, // 1 minute
    burstCapacity: 5,
    dimension: 'account',
    description: 'Processing job / batch / merge creation requests (5 / min / account)',
  },
  upload_init: {
    name: 'upload_init',
    limit: 5,
    windowSeconds: 60, // 1 minute
    burstCapacity: 5,
    dimension: 'account',
    description: 'Local file upload / multipart init requests (5 / min / account)',
  },
  job_cancel: {
    name: 'job_cancel',
    limit: 10,
    windowSeconds: 60, // 1 minute
    burstCapacity: 10,
    dimension: 'account',
    description: 'Job or batch cancellation requests (10 / min / account)',
  },
  reward_claim: {
    name: 'reward_claim',
    limit: 1,
    windowSeconds: 300, // 1 active claim at a time (5 min max claim TTL)
    burstCapacity: 1,
    dimension: 'active_claim',
    description: 'Rewarded ad session claims (1 active pending claim at a time per account)',
  },
  admin_api: {
    name: 'admin_api',
    limit: 60,
    windowSeconds: 60, // 1 minute
    burstCapacity: 60,
    dimension: 'account',
    description: 'Authenticated admin control endpoints (60 / min / admin)',
  },
};

export interface RateLimitEvaluation {
  allowed: boolean;
  policy: RateLimitPolicyName;
  limit: number;
  remaining: number;
  currentCount: number;
  resetSeconds: number;
  retryAfterSeconds: number;
  progressiveDelaySeconds?: number;
}

export interface RateLimitBackend {
  readonly kind: 'sqlite-hybrid' | 'redis';
  consume(
    bucketKey: string,
    limit: number,
    windowSeconds: number,
    burstCapacity: number,
    nowMs?: number
  ): RateLimitEvaluation;
  peek(bucketKey: string, limit: number, windowSeconds: number, nowMs?: number): {
    count: number;
    blockedUntilMs: number;
    resetSeconds: number;
  };
  setTemporaryBlock(bucketKey: string, durationSeconds: number, nowMs?: number): void;
  reset(bucketKey: string): void;
}

/**
 * Redis client contract for distributed deployments when REDIS_URL is configured.
 * Implementations execute an atomic Lua sliding-window + token-bucket script.
 */
export interface RedisRateLimitClient {
  evalSlidingWindow(
    key: string,
    limit: number,
    windowMs: number,
    nowMs: number
  ): { count: number; oldestMs: number; blockedUntilMs: number };
}

// ============================================================================
// Privacy & Log Redaction Utilities (NEVER log secrets, tokens, or raw URLs)
// ============================================================================

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|token|secret|auth(orization)?|cookie|csrf|api[_-]?key|sig(nature)?|jwt|session[_-]?id|code[_-]?verifier|backup[_-]?codes?|private|credential|raw[_-]?url|media[_-]?url|source[_-]?url|audio[_-]?url|video[_-]?url)/i;

const EMAIL_VALUE_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER_VALUE_PATTERN = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const URL_WITH_QUERY_OR_CREDS_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

/**
 * Truncates an IP address to a privacy-safe network prefix (/24 for IPv4, /48 for IPv6).
 */
export function truncateIpPrefix(rawIp?: string | null): string {
  if (!rawIp || typeof rawIp !== 'string') return 'unknown';
  let ip = rawIp.trim();
  if (!ip) return 'unknown';

  // Strip IPv4-mapped IPv6 prefix
  if (ip.toLowerCase().startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  // Strip port if present on IPv4 (e.g. 127.0.0.1:54321)
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.split(':')[0];
  }

  // IPv4 -> /24
  const ipv4Parts = ip.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.${ipv4Parts[2]}.0/24`;
  }

  // IPv6 -> /48
  if (ip.includes(':')) {
    const groups = ip.split(':').filter((g) => g.length > 0);
    const prefix = groups.slice(0, 3).join(':') || '::';
    return `${prefix}::/48`;
  }

  return 'unknown';
}

/**
 * Masks an email address for safe support/telemetry output.
 */
export function redactEmail(email: string): string {
  const idx = email.indexOf('@');
  if (idx <= 0) return '[REDACTED_EMAIL]';
  const local = email.slice(0, idx);
  const domain = email.slice(idx + 1);
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

/**
 * Strips credentials, query params, and paths from URLs so private signed URLs are never logged.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.hostname}/[REDACTED_PATH]`;
  } catch {
    return '[REDACTED_URL]';
  }
}

/**
 * Recursively scrubs sensitive fields, tokens, passwords, emails, and private URLs from any object.
 */
export function redactSensitiveData(value: unknown, depth: number = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    let scrubbed = value.replace(BEARER_VALUE_PATTERN, 'Bearer [REDACTED]');
    scrubbed = scrubbed.replace(EMAIL_VALUE_PATTERN, (m) => redactEmail(m));
    scrubbed = scrubbed.replace(URL_WITH_QUERY_OR_CREDS_PATTERN, (m) => redactUrl(m));
    if (scrubbed.length > 512) {
      scrubbed = `${scrubbed.slice(0, 512)}...[TRUNCATED]`;
    }
    return scrubbed;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => redactSensitiveData(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSensitiveData(val, depth + 1);
      }
    }
    return out;
  }

  return String(value);
}

/**
 * Extracts normalized client IP from a Fastify request safely.
 */
export function extractClientIp(request: FastifyRequest): string {
  const xff = request.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim().length > 0 && process.env.TRUST_PROXY === 'true') {
    return xff.split(',')[0].trim();
  }
  return request.ip || request.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Keyed HMAC-SHA256 hash for bucket keys (avoids storing raw emails or IPs in rate_limit_counters).
 */
export function hashBucketDimension(raw: string): string {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(raw.trim().toLowerCase())
    .digest('hex')
    .slice(0, 24);
}

// ============================================================================
// Hybrid Atomic SQLite + In-Memory Sliding Window & Token Bucket Backend
// ============================================================================

interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
}

class SqliteHybridRateLimitBackend implements RateLimitBackend {
  public readonly kind = 'sqlite-hybrid' as const;
  private readonly slidingLogs = new Map<string, number[]>();
  private readonly tokenBuckets = new Map<string, TokenBucketState>();
  private readonly gcTimer: NodeJS.Timeout;

  constructor() {
    this.gcTimer = setInterval(() => this.gc(), 60_000);
    this.gcTimer.unref();
  }

  public consume(
    bucketKey: string,
    limit: number,
    windowSeconds: number,
    burstCapacity: number,
    nowMs: number = Date.now()
  ): RateLimitEvaluation {
    const windowMs = windowSeconds * 1000;
    const windowStart = nowMs - windowMs;

    // 1. Atomic SQLite counter sync + block check
    const dbState = runInTransaction((db) => {
      const existing = db
        .prepare(
          `SELECT hits, window_start_ms, window_ms, blocked_until_ms
           FROM rate_limit_counters
           WHERE bucket_key = ?`
        )
        .get(bucketKey) as
        | {
            hits: number;
            window_start_ms: number;
            window_ms: number;
            blocked_until_ms: number;
          }
        | undefined;

      const blockedUntilMs = existing?.blocked_until_ms ?? 0;
      if (blockedUntilMs > nowMs) {
        return {
          blocked: true,
          blockedUntilMs,
          dbHits: existing?.hits ?? limit,
          dbWindowStartMs: existing?.window_start_ms ?? nowMs,
        };
      }

      // Compute sliding-window log in memory, seeded from SQLite if process restarted mid-window
      let log = this.slidingLogs.get(bucketKey);
      if (!log) {
        log = [];
        if (existing && existing.window_start_ms > windowStart && existing.hits > 0) {
          const seededCount = Math.min(existing.hits, limit + 5);
          for (let i = 0; i < seededCount; i++) {
            log.push(existing.window_start_ms);
          }
        }
      }

      // Prune expired timestamps from sliding window
      const activeTimestamps = log.filter((ts) => ts > windowStart);

      // Token bucket refill calculation
      const refillRatePerMs = limit / windowMs;
      let tb = this.tokenBuckets.get(bucketKey);
      if (!tb) {
        const initialTokens = Math.max(0, burstCapacity - activeTimestamps.length);
        tb = { tokens: initialTokens, lastRefillMs: nowMs };
      } else {
        const elapsed = Math.max(0, nowMs - tb.lastRefillMs);
        tb.tokens = Math.min(burstCapacity, tb.tokens + elapsed * refillRatePerMs);
        tb.lastRefillMs = nowMs;
      }

      const wouldExceedSliding = activeTimestamps.length >= limit;
      const wouldExceedBucket = tb.tokens < 1;

      if (wouldExceedSliding || wouldExceedBucket) {
        this.slidingLogs.set(bucketKey, activeTimestamps);
        this.tokenBuckets.set(bucketKey, tb);

        const oldest = activeTimestamps.length > 0 ? activeTimestamps[0] : nowMs;
        const resetMs = Math.max(1000, windowMs - (nowMs - oldest));

        db.prepare(
          `INSERT INTO rate_limit_counters (bucket_key, hits, window_start_ms, window_ms, blocked_until_ms, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET
             hits = excluded.hits,
             window_start_ms = excluded.window_start_ms,
             window_ms = excluded.window_ms,
             updated_at = excluded.updated_at`
        ).run(
          bucketKey,
          activeTimestamps.length,
          oldest,
          windowMs,
          blockedUntilMs,
          new Date(nowMs).toISOString()
        );

        return {
          blocked: true,
          blockedUntilMs: nowMs + resetMs,
          dbHits: activeTimestamps.length,
          dbWindowStartMs: oldest,
        };
      }

      // Consume 1 token & append timestamp
      activeTimestamps.push(nowMs);
      tb.tokens = Math.max(0, tb.tokens - 1);
      this.slidingLogs.set(bucketKey, activeTimestamps);
      this.tokenBuckets.set(bucketKey, tb);

      const oldest = activeTimestamps[0];
      db.prepare(
        `INSERT INTO rate_limit_counters (bucket_key, hits, window_start_ms, window_ms, blocked_until_ms, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(bucket_key) DO UPDATE SET
           hits = excluded.hits,
           window_start_ms = excluded.window_start_ms,
           window_ms = excluded.window_ms,
           blocked_until_ms = 0,
           updated_at = excluded.updated_at`
      ).run(bucketKey, activeTimestamps.length, oldest, windowMs, new Date(nowMs).toISOString());

      return {
        blocked: false,
        blockedUntilMs: 0,
        dbHits: activeTimestamps.length,
        dbWindowStartMs: oldest,
      };
    });

    const elapsedMs = Math.max(0, nowMs - dbState.dbWindowStartMs);
    const resetSeconds = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
    const retryAfterSeconds = dbState.blocked
      ? Math.max(1, Math.ceil((dbState.blockedUntilMs - nowMs) / 1000))
      : 0;

    return {
      allowed: !dbState.blocked,
      policy: 'media_inspect', // overwritten by caller
      limit,
      remaining: Math.max(0, limit - dbState.dbHits),
      currentCount: dbState.dbHits,
      resetSeconds,
      retryAfterSeconds,
    };
  }

  public peek(
    bucketKey: string,
    _limit: number,
    windowSeconds: number,
    nowMs: number = Date.now()
  ): { count: number; blockedUntilMs: number; resetSeconds: number } {
    const windowMs = windowSeconds * 1000;
    const windowStart = nowMs - windowMs;
    const db = getDb();
    const row = db
      .prepare(
        `SELECT hits, window_start_ms, blocked_until_ms FROM rate_limit_counters WHERE bucket_key = ?`
      )
      .get(bucketKey) as
      | { hits: number; window_start_ms: number; blocked_until_ms: number }
      | undefined;

    const log = this.slidingLogs.get(bucketKey);
    const active = log ? log.filter((ts) => ts > windowStart) : null;
    if (active) {
      this.slidingLogs.set(bucketKey, active);
    }

    const blockedUntilMs = row?.blocked_until_ms ?? 0;
    const count = active
      ? active.length
      : row && row.window_start_ms > windowStart
      ? row.hits
      : 0;

    const oldest = active && active.length > 0 ? active[0] : row?.window_start_ms ?? nowMs;
    const resetSeconds = Math.max(1, Math.ceil((windowMs - Math.max(0, nowMs - oldest)) / 1000));

    return { count, blockedUntilMs, resetSeconds };
  }

  public setTemporaryBlock(bucketKey: string, durationSeconds: number, nowMs: number = Date.now()): void {
    const blockedUntilMs = nowMs + Math.max(1, Math.floor(durationSeconds)) * 1000;
    const db = getDb();
    db.prepare(
      `INSERT INTO rate_limit_counters (bucket_key, hits, window_start_ms, window_ms, blocked_until_ms, updated_at)
       VALUES (?, 1, ?, ?, ?, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET
         blocked_until_ms = CASE
           WHEN excluded.blocked_until_ms > rate_limit_counters.blocked_until_ms
           THEN excluded.blocked_until_ms
           ELSE rate_limit_counters.blocked_until_ms
         END,
         updated_at = excluded.updated_at`
    ).run(bucketKey, nowMs, 900_000, blockedUntilMs, new Date(nowMs).toISOString());
  }

  public reset(bucketKey: string): void {
    this.slidingLogs.delete(bucketKey);
    this.tokenBuckets.delete(bucketKey);
    const db = getDb();
    db.prepare('DELETE FROM rate_limit_counters WHERE bucket_key = ?').run(bucketKey);
  }

  private gc(): void {
    const now = Date.now();
    const cutoff = now - 3_600_000; // 1 hour
    for (const [key, log] of this.slidingLogs.entries()) {
      const valid = log.filter((ts) => ts > cutoff);
      if (valid.length === 0) {
        this.slidingLogs.delete(key);
        this.tokenBuckets.delete(key);
      } else {
        this.slidingLogs.set(key, valid);
      }
    }
    try {
      const db = getDb();
      db.prepare(
        `DELETE FROM rate_limit_counters WHERE (window_start_ms + window_ms) < ? AND blocked_until_ms < ?`
      ).run(cutoff, now);
    } catch {
      // ignore if DB closed during shutdown
    }
  }
}

// ============================================================================
// Multi-Layer Rate Limit & Security Event Service
// ============================================================================

export interface SecurityEventInput {
  eventType: SecurityEventType;
  severity?: SecuritySeverity;
  userId?: string | null;
  publicUserId?: string | null;
  ip?: string | null;
  endpoint?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
}

interface DuplicateFloodTracker {
  timestamps: number[];
}

export class RateLimitService {
  private readonly backend: RateLimitBackend;
  private readonly redisConfigured: boolean;
  private readonly duplicateFloodMap = new Map<string, DuplicateFloodTracker>();
  private readonly spikeCounterMap = new Map<string, number[]>();

  constructor(customBackend?: RateLimitBackend) {
    this.redisConfigured = Boolean(process.env.REDIS_URL && process.env.REDIS_URL.trim().length > 0);
    this.backend = customBackend ?? new SqliteHybridRateLimitBackend();
  }

  public getBackendStatus(): {
    activeBackend: string;
    redisUrlConfigured: boolean;
    rateLimitEnabled: boolean;
    policies: Readonly<Record<RateLimitPolicyName, RateLimitPolicy>>;
  } {
    return {
      activeBackend: this.backend.kind,
      redisUrlConfigured: this.redisConfigured,
      rateLimitEnabled: config.rateLimitEnabled,
      policies: RATE_LIMIT_POLICIES,
    };
  }

  /**
   * Records a strictly redacted structured security event into `security_events`.
   */
  public recordSecurityEvent(input: SecurityEventInput): string {
    const id = generatePrefixedId('sec', 10);
    const sanitizedDetails = redactSensitiveData(input.details ?? {}) as Record<string, unknown>;
    const ipPrefix = truncateIpPrefix(input.ip);
    const now = new Date().toISOString();

    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO security_events
         (id, event_type, severity, user_id, public_user_id, ip_prefix, endpoint, request_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        input.eventType,
        input.severity ?? 'WARN',
        input.userId ?? null,
        input.publicUserId ?? null,
        ipPrefix,
        input.endpoint ? String(input.endpoint).slice(0, 128) : null,
        input.requestId ?? null,
        JSON.stringify(sanitizedDetails),
        now
      );
    } catch {
      // Never crash request pipeline if telemetry DB write fails
    }

    return id;
  }

  /**
   * Evaluates a named rate-limit policy for the provided dimension key.
   */
  public checkPolicy(
    policyName: RateLimitPolicyName,
    dimensionKey: string,
    context?: {
      userId?: string | null;
      publicUserId?: string | null;
      ip?: string | null;
      endpoint?: string | null;
      requestId?: string | null;
    }
  ): RateLimitEvaluation {
    const policy = RATE_LIMIT_POLICIES[policyName];

    if (!config.rateLimitEnabled) {
      return {
        allowed: true,
        policy: policyName,
        limit: policy.limit,
        remaining: policy.limit,
        currentCount: 0,
        resetSeconds: policy.windowSeconds,
        retryAfterSeconds: 0,
      };
    }

    const hashedKey = `${policyName}:${hashBucketDimension(dimensionKey)}`;
    const result = this.backend.consume(
      hashedKey,
      policy.limit,
      policy.windowSeconds,
      policy.burstCapacity
    );
    result.policy = policyName;

    if (!result.allowed) {
      this.trackRateLimitSpike(hashedKey, policyName, context);
    }

    return result;
  }

  /**
   * Checks whether a login attempt is allowed BEFORE verifying password.
   * Enforces:
   * - Login IP limit: 20 / 15 min / IP
   * - Login account progressive backoff / 5 failed attempts / 15 min (never permanent DoS lock)
   */
  public checkLoginAllowed(
    accountIdentifier: string,
    clientIp: string,
    requestId?: string
  ): RateLimitEvaluation {
    if (!config.rateLimitEnabled) {
      return {
        allowed: true,
        policy: 'login_ip',
        limit: RATE_LIMIT_POLICIES.login_ip.limit,
        remaining: RATE_LIMIT_POLICIES.login_ip.limit,
        currentCount: 0,
        resetSeconds: 900,
        retryAfterSeconds: 0,
      };
    }

    // Layer 1: Client IP rate limit (20 / 15 min)
    const ipEval = this.checkPolicy('login_ip', clientIp, {
      ip: clientIp,
      endpoint: 'POST /api/v1/auth/login',
      requestId,
    });
    if (!ipEval.allowed) {
      this.recordSecurityEvent({
        eventType: 'BRUTE_FORCE',
        severity: 'HIGH',
        ip: clientIp,
        endpoint: 'POST /api/v1/auth/login',
        requestId,
        details: {
          layer: 'login_ip',
          limit: ipEval.limit,
          windowSeconds: RATE_LIMIT_POLICIES.login_ip.windowSeconds,
        },
      });
      return ipEval;
    }

    // Layer 2: Account failed-attempt window & progressive backoff (5 / 15 min / account)
    const normalizedAccount = accountIdentifier.trim().toLowerCase();
    if (!normalizedAccount) {
      return ipEval;
    }

    const acctKey = `login_account:${hashBucketDimension(normalizedAccount)}`;
    const policy = RATE_LIMIT_POLICIES.login_account;
    const nowMs = Date.now();
    const state = this.backend.peek(acctKey, policy.limit, policy.windowSeconds, nowMs);

    if (state.blockedUntilMs > nowMs || state.count >= policy.limit) {
      const retryAfterSeconds =
        state.blockedUntilMs > nowMs
          ? Math.max(1, Math.ceil((state.blockedUntilMs - nowMs) / 1000))
          : state.resetSeconds;

      this.recordSecurityEvent({
        eventType: 'BRUTE_FORCE',
        severity: 'HIGH',
        ip: clientIp,
        endpoint: 'POST /api/v1/auth/login',
        requestId,
        details: {
          layer: 'login_account',
          failureCount: state.count,
          retryAfterSeconds,
        },
      });

      return {
        allowed: false,
        policy: 'login_account',
        limit: policy.limit,
        remaining: 0,
        currentCount: state.count,
        resetSeconds: state.resetSeconds,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      policy: 'login_account',
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - state.count),
      currentCount: state.count,
      resetSeconds: state.resetSeconds,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Records a failed login attempt for an account and applies progressive temporary delay.
   * Never applies a permanent account lockout (prevents targeted DoS).
   */
  public recordLoginFailure(
    accountIdentifier: string,
    clientIp: string,
    requestId?: string
  ): RateLimitEvaluation {
    const policy = RATE_LIMIT_POLICIES.login_account;
    const normalizedAccount = accountIdentifier.trim().toLowerCase() || clientIp;
    const acctKey = `login_account:${hashBucketDimension(normalizedAccount)}`;

    const evalResult = this.backend.consume(
      acctKey,
      policy.limit,
      policy.windowSeconds,
      policy.burstCapacity
    );
    evalResult.policy = 'login_account';

    const delays = policy.progressiveDelaysSeconds ?? [0, 1, 2, 4, 8, 15];
    const delayIdx = Math.min(evalResult.currentCount, delays.length - 1);
    const progressiveDelaySeconds = delays[delayIdx];
    evalResult.progressiveDelaySeconds = progressiveDelaySeconds;

    if (!evalResult.allowed || evalResult.currentCount >= policy.limit) {
      // Temporary cooldown (progressive max 60s or window reset, never permanent)
      const cooldownSeconds = Math.min(policy.windowSeconds, Math.max(30, progressiveDelaySeconds * 4));
      this.backend.setTemporaryBlock(acctKey, cooldownSeconds);
      evalResult.retryAfterSeconds = cooldownSeconds;

      this.recordSecurityEvent({
        eventType: 'BRUTE_FORCE',
        severity: 'HIGH',
        ip: clientIp,
        endpoint: 'POST /api/v1/auth/login',
        requestId,
        details: {
          layer: 'login_account_failure',
          attemptsInWindow: evalResult.currentCount,
          cooldownSeconds,
        },
      });
    } else if (evalResult.currentCount >= 3) {
      this.recordSecurityEvent({
        eventType: 'BRUTE_FORCE',
        severity: 'WARN',
        ip: clientIp,
        endpoint: 'POST /api/v1/auth/login',
        requestId,
        details: {
          layer: 'login_account_warning',
          attemptsInWindow: evalResult.currentCount,
          progressiveDelaySeconds,
        },
      });
    }

    return evalResult;
  }

  /**
   * Clears account login failure counter after a successful authentication.
   */
  public resetLoginFailures(accountIdentifier: string): void {
    const normalizedAccount = accountIdentifier.trim().toLowerCase();
    if (!normalizedAccount) return;
    const acctKey = `login_account:${hashBucketDimension(normalizedAccount)}`;
    this.backend.reset(acctKey);
  }

  /**
   * Enforces "1 active reward claim at a time" per account by checking persistent `reward_sessions`.
   */
  public checkActiveRewardClaim(
    userId: string,
    context?: { publicUserId?: string | null; ip?: string | null; requestId?: string | null }
  ): RateLimitEvaluation {
    if (!config.rateLimitEnabled) {
      return {
        allowed: true,
        policy: 'reward_claim',
        limit: 1,
        remaining: 1,
        currentCount: 0,
        resetSeconds: 60,
        retryAfterSeconds: 0,
      };
    }

    const db = getDb();
    const nowIso = new Date().toISOString();
    const active = db
      .prepare(
        `SELECT id, expires_at FROM reward_sessions
         WHERE user_id = ? AND status = 'PENDING' AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId, nowIso) as { id: string; expires_at: string } | undefined;

    if (active) {
      const remainingMs = Math.max(1000, new Date(active.expires_at).getTime() - Date.now());
      const retryAfterSeconds = Math.max(1, Math.min(300, Math.ceil(remainingMs / 1000)));
      this.recordSecurityEvent({
        eventType: 'RATE_LIMIT_SPIKE',
        severity: 'WARN',
        userId,
        publicUserId: context?.publicUserId,
        ip: context?.ip,
        endpoint: 'POST /api/v1/rewards/sessions',
        requestId: context?.requestId,
        details: {
          policy: 'reward_claim',
          reason: 'active_pending_claim_exists',
          retryAfterSeconds,
        },
      });

      return {
        allowed: false,
        policy: 'reward_claim',
        limit: 1,
        remaining: 0,
        currentCount: 1,
        resetSeconds: retryAfterSeconds,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      policy: 'reward_claim',
      limit: 1,
      remaining: 1,
      currentCount: 0,
      resetSeconds: 300,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Detects duplicate request flooding (identical mutation payload burst within 10s).
   * Logs `DUPLICATE_FLOOD` security event and throttles excessive identical floods.
   */
  public checkDuplicateFlood(
    actorKey: string,
    endpoint: string,
    payloadFingerprint: string,
    context?: { userId?: string | null; ip?: string | null; requestId?: string | null }
  ): { flooded: boolean; count: number; retryAfterSeconds: number } {
    if (!config.rateLimitEnabled) {
      return { flooded: false, count: 0, retryAfterSeconds: 0 };
    }

    const key = hashBucketDimension(`${actorKey}:${endpoint}:${payloadFingerprint}`);
    const now = Date.now();
    const windowMs = 10_000;
    const tracker = this.duplicateFloodMap.get(key) ?? { timestamps: [] };
    tracker.timestamps = tracker.timestamps.filter((ts) => ts > now - windowMs);
    tracker.timestamps.push(now);
    this.duplicateFloodMap.set(key, tracker);

    if (this.duplicateFloodMap.size > 5000) {
      // Bounded memory eviction
      const oldestKey = this.duplicateFloodMap.keys().next().value;
      if (oldestKey) this.duplicateFloodMap.delete(oldestKey);
    }

    if (tracker.timestamps.length > 8) {
      this.recordSecurityEvent({
        eventType: 'DUPLICATE_FLOOD',
        severity: 'WARN',
        userId: context?.userId,
        ip: context?.ip,
        endpoint,
        requestId: context?.requestId,
        details: {
          countIn10s: tracker.timestamps.length,
        },
      });
      return { flooded: true, count: tracker.timestamps.length, retryAfterSeconds: 10 };
    }

    return { flooded: false, count: tracker.timestamps.length, retryAfterSeconds: 0 };
  }

  /**
   * Formats RFC-compliant rate limit headers (never leaks internal risk scores).
   */
  public applyHeaders(reply: FastifyReply, result: RateLimitEvaluation): void {
    reply.header('RateLimit-Limit', String(result.limit));
    reply.header('RateLimit-Remaining', String(result.remaining));
    reply.header('RateLimit-Reset', String(result.resetSeconds));
    if (!result.allowed && result.retryAfterSeconds > 0) {
      reply.header('Retry-After', String(result.retryAfterSeconds));
    }
  }

  /**
   * Sends a clean, safe HTTP 429 Too Many Requests response without revealing internal risk scores.
   */
  public sendRateLimitExceeded(
    request: FastifyRequest,
    reply: FastifyReply,
    result: RateLimitEvaluation
  ) {
    this.applyHeaders(reply, result);
    const requestId = (request.id as string) || `req_${Date.now()}`;
    return reply.code(429).send({
      success: false,
      error: {
        code: 'ERR_RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please wait a moment and try again.',
        userMessage: 'Too many requests right now. Please wait a moment and try again.',
        details: {
          retryAfterSeconds: Math.max(1, result.retryAfterSeconds),
        },
      },
      requestId,
    });
  }

  /**
   * Creates a Fastify preHandler hook for a specific rate limit policy.
   */
  public createPreHandler(
    policyName: RateLimitPolicyName,
    resolveDimension?: (request: FastifyRequest) => {
      key: string;
      userId?: string | null;
      publicUserId?: string | null;
    }
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const clientIp = extractClientIp(request);
      const dim = resolveDimension
        ? resolveDimension(request)
        : {
            key:
              RATE_LIMIT_POLICIES[policyName].dimension === 'ip'
                ? clientIp
                : this.resolveRequestActorKey(request, clientIp),
            userId: (request as any).authUser?.id ?? null,
            publicUserId: (request as any).authUser?.publicUserId ?? null,
          };

      const evaluation =
        policyName === 'reward_claim' && dim.userId
          ? this.checkActiveRewardClaim(dim.userId, {
              publicUserId: dim.publicUserId,
              ip: clientIp,
              requestId: request.id as string,
            })
          : this.checkPolicy(policyName, dim.key, {
              userId: dim.userId,
              publicUserId: dim.publicUserId,
              ip: clientIp,
              endpoint: `${request.method} ${request.routeOptions?.url || request.url.split('?')[0]}`,
              requestId: request.id as string,
            });

      this.applyHeaders(reply, evaluation);
      if (!evaluation.allowed) {
        return this.sendRateLimitExceeded(request, reply, evaluation);
      }
    };
  }

  /**
   * Resolves a stable actor dimension from authenticated session, bearer header, guest cookie, or client IP.
   */
  public resolveRequestActorKey(request: FastifyRequest, clientIp?: string): string {
    const authUser = (request as any).authUser as { id?: string } | undefined;
    if (authUser?.id) return `usr:${authUser.id}`;

    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.trim().length > 0) {
      return `hdr:${hashBucketDimension(authHeader)}`;
    }

    const cookieHeader = request.headers.cookie;
    if (typeof cookieHeader === 'string') {
      const sessionMatch = cookieHeader.match(/(?:^|;\s*)(muxaro_session|muxaro_guest)=([^;]+)/);
      if (sessionMatch?.[2]) {
        return `ses:${hashBucketDimension(sessionMatch[2])}`;
      }
    }

    return `ip:${clientIp || extractClientIp(request)}`;
  }

  /**
   * Returns whether a request path is a job/batch polling or health read that must NEVER be tightly throttled.
   */
  public isExemptPollingRoute(method: string, pathWithoutQuery: string): boolean {
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      return false;
    }
    if (
      pathWithoutQuery === '/api/v1/health' ||
      pathWithoutQuery === '/api/v1/auth/session' ||
      pathWithoutQuery === '/api/v1/admin/metrics' ||
      pathWithoutQuery === '/api/v1/rewards/config' ||
      pathWithoutQuery.startsWith('/docs')
    ) {
      return true;
    }
    // Job polling, SSE progress streams, batch status polling, download delivery
    if (/^\/api\/v1\/jobs\/[^/]+(\/events|\/download)?$/.test(pathWithoutQuery)) {
      return true;
    }
    if (/^\/api\/v1\/batches\/[^/]+(\/jobs)?$/.test(pathWithoutQuery)) {
      return true;
    }
    if (/^\/api\/v1\/playlists\/[^/]+$/.test(pathWithoutQuery)) {
      return true;
    }
    if (/^\/api\/v1\/download\/[^/]+$/.test(pathWithoutQuery)) {
      return true;
    }
    return false;
  }

  private trackRateLimitSpike(
    hashedKey: string,
    policyName: RateLimitPolicyName,
    context?: {
      userId?: string | null;
      publicUserId?: string | null;
      ip?: string | null;
      endpoint?: string | null;
      requestId?: string | null;
    }
  ): void {
    const now = Date.now();
    const windowMs = 60_000;
    const hits = (this.spikeCounterMap.get(hashedKey) ?? []).filter((ts) => ts > now - windowMs);
    hits.push(now);
    this.spikeCounterMap.set(hashedKey, hits);

    // Log first breach and sustained spikes without flooding the DB on every single repeat
    if (hits.length === 1 || hits.length === 5 || hits.length % 15 === 0) {
      this.recordSecurityEvent({
        eventType: 'RATE_LIMIT_SPIKE',
        severity: hits.length >= 5 ? 'HIGH' : 'WARN',
        userId: context?.userId,
        publicUserId: context?.publicUserId,
        ip: context?.ip,
        endpoint: context?.endpoint,
        requestId: context?.requestId,
        details: {
          policy: policyName,
          blockedHitsLast60s: hits.length,
        },
      });
    }
  }
}

export const rateLimitService = new RateLimitService();
