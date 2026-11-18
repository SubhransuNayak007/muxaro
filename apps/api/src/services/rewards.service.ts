/**
 * Project MUXARO - Google Ad Manager Rewarded Ads & Server-Side Verification (SSV) Service
 *
 * Security Invariants:
 * 1. Rewarded credits are NEVER granted from client-side requests or client flags.
 * 2. Every reward requires a valid ECDSA-SHA256 provider callback verified against Google's
 *    official verifier keys (or configured GAM_SSV_PUBLIC_KEY_PEM for deterministic testing).
 * 3. `custom_data` is HMAC-SHA256 signed and bound to both `sessionId` and authenticated `userId`.
 * 4. Replay protection is enforced atomically via UNIQUE `provider_transaction_id` in
 *    `reward_provider_events` + atomic state transition on `reward_sessions`.
 * 5. Daily cap (default 3 verified ads / rolling 24h) and max 1 active pending session per user
 *    are enforced on both session creation and callback settlement.
 * 6. Rewarded credits apply ONLY to individual jobs (+2 per ad, max 16/24h on Free tier) and
 *    expire automatically after a rolling 24-hour window; playlist allowance stays unchanged.
 */

import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { getDb, runInTransaction, recordAnalyticsEvent } from '../db/database.js';
import { generatePrefixedId, generateRewardSessionId } from './id.service.js';
import { entitlementsService, type UnifiedQuotaStatus } from './entitlements.service.js';

export const DEFAULT_GAM_SSV_KEY_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const DEFAULT_REWARD_SESSION_TTL_SECONDS = 600; // 10 minutes
const KEY_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const KEY_REFRESH_MIN_INTERVAL_MS = 60 * 1000; // 60 seconds

export type RewardSessionStatus = 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'REJECTED';

export interface RewardConfigSummary {
  enabled: boolean;
  featureEnabled: boolean;
  configured: boolean;
  adUnitPath: string | null;
  rewardAmount: number;
  dailyCap: number;
  rewardedAdsUsedToday: number;
  remainingAdsToday: number;
  maxIndividualWithRewards: number;
  expiryHours: number;
  ssvKeyUrl: string;
}

export interface RewardSessionCreateResult {
  sessionId: string;
  adUnitPath: string;
  customData: string;
  rewardAmount: number;
  status: RewardSessionStatus;
  expiresAt: string;
  remainingAdsToday: number;
  dailyCap: number;
}

export interface RewardSessionStatusResult {
  sessionId: string;
  status: RewardSessionStatus;
  provider: string;
  adUnitPath: string;
  rewardAmount: number;
  creditsGranted: number;
  expiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  quota: UnifiedQuotaStatus;
}

export interface ProviderCallbackInput {
  method: 'GET' | 'POST';
  rawUrl?: string;
  rawQueryString?: string;
  params: Record<string, unknown>;
  ipAddress?: string;
  requestId?: string;
}

export interface ProviderCallbackResult {
  statusCode: number;
  processed: boolean;
  duplicate: boolean;
  sessionId: string | null;
  transactionId: string;
  status: string;
  creditsGranted: number;
  expiresAt?: string | null;
  extraCreditsRemaining?: number;
  totalAvailableIndividual?: number;
  message: string;
}

interface CustomDataPayload {
  s: string; // reward session ID (MXRWD-...)
  u: string; // internal user ID
  exp: number; // expiry epoch ms
}

interface CachedVerifierKeys {
  url: string;
  keys: Map<string, string>; // keyId -> PEM
  fetchedAtMs: number;
  expiresAtMs: number;
}

function getIpPrefix(ip?: string): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (clean.includes('.')) {
    const parts = clean.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : clean;
  }
  if (clean.includes(':')) {
    return `${clean.split(':').slice(0, 4).join(':')}::/64`;
  }
  return clean.slice(0, 32);
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizePem(pem: string): string {
  const unescaped = pem.replace(/\\n/g, '\n').trim();
  return unescaped;
}

function decodeSignatureBuffers(signatureRaw: string): Buffer[] {
  const trimmed = signatureRaw.trim();
  const candidates: Buffer[] = [];
  const seen = new Set<string>();

  const pushUnique = (buf: Buffer) => {
    if (buf.length === 0) return;
    const key = buf.toString('hex');
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(buf);
    }
  };

  // Base64URL (Google SSV standard)
  const b64Standard = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64Standard.length % 4 === 0 ? '' : '='.repeat(4 - (b64Standard.length % 4));
  try {
    pushUnique(Buffer.from(b64Standard + pad, 'base64'));
  } catch {
    // ignore
  }
  try {
    pushUnique(Buffer.from(trimmed, 'base64url'));
  } catch {
    // ignore
  }
  return candidates;
}

function verifyEcdsaSignature(
  publicKeyPem: string,
  payloadCandidates: string[],
  signatureRaw: string
): boolean {
  const sigBuffers = decodeSignatureBuffers(signatureRaw);
  if (sigBuffers.length === 0) return false;

  let keyObject: crypto.KeyObject;
  try {
    keyObject = crypto.createPublicKey(publicKeyPem);
  } catch {
    return false;
  }

  for (const payload of payloadCandidates) {
    const dataBuf = Buffer.from(payload, 'utf8');
    for (const sigBuf of sigBuffers) {
      // Standard ASN.1 DER ECDSA signature (Google Ad Manager / AdMob SSV default)
      try {
        if (crypto.verify('sha256', dataBuf, { key: keyObject, dsaEncoding: 'der' }, sigBuf)) {
          return true;
        }
      } catch {
        // continue
      }
      // Fallback: IEEE P1363 raw (r || s) ECDSA signature
      try {
        if (crypto.verify('sha256', dataBuf, { key: keyObject, dsaEncoding: 'ieee-p1363' }, sigBuf)) {
          return true;
        }
      } catch {
        // continue
      }
    }
  }
  return false;
}

export class RewardsService {
  private verifierKeyCache: CachedVerifierKeys | null = null;
  private lastRemoteFetchAttemptMs = 0;

  private getCustomDataSecret(): string {
    return `${config.signedTokenSecret}:muxaro-gam-ssv-custom-data-v1`;
  }

  private getAdUnitPath(): string | null {
    const raw = (process.env.GAM_REWARDED_AD_UNIT_PATH || '').trim();
    return raw.length > 0 ? raw : null;
  }

  private getSsvKeyUrl(): string {
    return (process.env.GAM_SSV_KEY_URL || DEFAULT_GAM_SSV_KEY_URL).trim();
  }

  private getSessionTtlMs(): number {
    const secs = Number(process.env.REWARD_SESSION_TTL_SECONDS || DEFAULT_REWARD_SESSION_TTL_SECONDS);
    return (Number.isFinite(secs) && secs >= 30 ? secs : DEFAULT_REWARD_SESSION_TTL_SECONDS) * 1000;
  }

  private logSecurityEvent(
    db: DatabaseSync,
    params: {
      eventType: string;
      severity: 'INFO' | 'WARN' | 'HIGH';
      userId?: string | null;
      ipAddress?: string;
      endpoint?: string;
      requestId?: string;
      details?: Record<string, unknown>;
    }
  ): void {
    try {
      db.prepare(
        `INSERT INTO security_events
          (id, event_type, severity, user_id, public_user_id, ip_prefix, endpoint, request_id, details_json, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
      ).run(
        generatePrefixedId('sec'),
        params.eventType,
        params.severity,
        params.userId ?? null,
        getIpPrefix(params.ipAddress),
        params.endpoint || '/api/v1/rewards',
        params.requestId ?? null,
        JSON.stringify(params.details || {}),
        new Date().toISOString()
      );
    } catch {
      // Non-blocking audit log
    }
  }

  /**
   * Signs `custom_data` with HMAC-SHA256 binding `sessionId + userId + exp`.
   * Pure base64url + '.' so it never requires percent-encoding in Google SSV query params.
   */
  public signCustomData(payload: CustomDataPayload): string {
    const bodyB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const mac = crypto
      .createHmac('sha256', this.getCustomDataSecret())
      .update(bodyB64, 'utf8')
      .digest('base64url');
    return `${bodyB64}.${mac}`;
  }

  /**
   * Verifies HMAC-SHA256 `custom_data` using constant-time comparison.
   */
  public verifyCustomData(customData: string): CustomDataPayload | null {
    if (!customData || typeof customData !== 'string') return null;
    const dotIdx = customData.indexOf('.');
    if (dotIdx <= 0 || dotIdx !== customData.lastIndexOf('.')) return null;

    const bodyB64 = customData.slice(0, dotIdx);
    const sigB64 = customData.slice(dotIdx + 1);
    if (!bodyB64 || !sigB64) return null;

    const expectedMac = crypto
      .createHmac('sha256', this.getCustomDataSecret())
      .update(bodyB64, 'utf8')
      .digest();

    let providedMac: Buffer;
    try {
      providedMac = Buffer.from(sigB64, 'base64url');
    } catch {
      return null;
    }

    if (providedMac.length !== expectedMac.length) return null;
    if (!crypto.timingSafeEqual(providedMac, expectedMac)) return null;

    try {
      const parsed = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8')) as Partial<CustomDataPayload>;
      if (
        typeof parsed.s === 'string' &&
        parsed.s.length > 0 &&
        typeof parsed.u === 'string' &&
        parsed.u.length > 0 &&
        typeof parsed.exp === 'number' &&
        Number.isFinite(parsed.exp)
      ) {
        return { s: parsed.s, u: parsed.u, exp: parsed.exp };
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Returns honest rewarded-ads configuration status for frontend rendering.
   * Never reports `configured: true` or `enabled: true` when `GAM_REWARDED_AD_UNIT_PATH` is absent.
   */
  public getRewardConfig(userId?: string | null): RewardConfigSummary {
    const db = getDb();
    const policy = entitlementsService.getPolicy(db);
    const adUnitPath = this.getAdUnitPath();
    const configured = Boolean(adUnitPath);
    const featureEnabled = policy.rewardedAdsEnabled;
    const enabled = featureEnabled && configured;

    const rewardedAdsUsedToday = userId
      ? entitlementsService.getVerifiedRewardAdsCount24h(userId, Date.now(), db)
      : 0;
    const remainingAdsToday = Math.max(0, policy.rewardDailyCap - rewardedAdsUsedToday);
    const maxIndividualWithRewards =
      policy.freeIndividualLimit + policy.rewardDailyCap * policy.rewardCreditsPerAd;

    return {
      enabled,
      featureEnabled,
      configured,
      adUnitPath,
      rewardAmount: policy.rewardCreditsPerAd,
      dailyCap: policy.rewardDailyCap,
      rewardedAdsUsedToday,
      remainingAdsToday,
      maxIndividualWithRewards,
      expiryHours: policy.rewardExpiryHours,
      ssvKeyUrl: this.getSsvKeyUrl(),
    };
  }

  /**
   * Creates a server-side `reward_sessions` row bound to the authenticated user.
   * Enforces:
   * - Real GAM configuration (`503 ERR_REWARDED_ADS_NOT_CONFIGURED` if unconfigured)
   * - Max 1 active `PENDING` session per user (`409 ERR_REWARD_SESSION_ACTIVE`)
   * - Daily cap of 3 verified rewarded ads per rolling 24h (`409 ERR_REWARD_DAILY_CAP_REACHED`)
   */
  public createRewardSession(params: {
    userId: string;
    ipAddress?: string;
    requestId?: string;
  }): RewardSessionCreateResult {
    const cfg = this.getRewardConfig(params.userId);
    if (!cfg.enabled || !cfg.configured || !cfg.adUnitPath) {
      const err = new Error(
        'Rewarded ads are not currently configured or enabled on this deployment.'
      );
      (err as any).statusCode = 503;
      (err as any).code = 'ERR_REWARDED_ADS_NOT_CONFIGURED';
      throw err;
    }

    const adUnitPath = cfg.adUnitPath;

    return runInTransaction((db) => {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const policy = entitlementsService.getPolicy(db);

      // Expire any stale pending sessions for this user first
      db.prepare(
        `UPDATE reward_sessions
         SET status = 'EXPIRED', updated_at = ?
         WHERE user_id = ? AND status = 'PENDING' AND expires_at <= ?`
      ).run(nowIso, params.userId, nowIso);

      // Enforce max 1 active pending claim per user
      const activePending = db
        .prepare(
          `SELECT id, expires_at
           FROM reward_sessions
           WHERE user_id = ? AND status = 'PENDING' AND expires_at > ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(params.userId, nowIso) as { id: string; expires_at: string } | undefined;

      if (activePending) {
        this.logSecurityEvent(db, {
          eventType: 'REWARD_CONCURRENT_CLAIM_BLOCKED',
          severity: 'INFO',
          userId: params.userId,
          ipAddress: params.ipAddress,
          endpoint: 'POST /api/v1/rewards/sessions',
          requestId: params.requestId,
          details: { activeSessionId: activePending.id },
        });
        const err = new Error(
          'You already have an active rewarded ad session in progress. Complete or wait for it to expire before starting another.'
        );
        (err as any).statusCode = 409;
        (err as any).code = 'ERR_REWARD_SESSION_ACTIVE';
        (err as any).details = {
          activeSessionId: activePending.id,
          expiresAt: activePending.expires_at,
        };
        throw err;
      }

      // Enforce daily cap (default 3 verified rewarded ads / rolling 24h)
      const usedToday = entitlementsService.getVerifiedRewardAdsCount24h(params.userId, nowMs, db);
      if (usedToday >= policy.rewardDailyCap) {
        const err = new Error(
          `Daily rewarded ad cap reached (${usedToday}/${policy.rewardDailyCap} in the rolling 24-hour window).`
        );
        (err as any).statusCode = 409;
        (err as any).code = 'ERR_REWARD_DAILY_CAP_REACHED';
        (err as any).details = {
          rewardedAdsUsedToday: usedToday,
          dailyCap: policy.rewardDailyCap,
          remainingAdsToday: 0,
        };
        throw err;
      }

      const sessionId = generateRewardSessionId();
      const expiresAtMs = nowMs + this.getSessionTtlMs();
      const expiresAt = new Date(expiresAtMs).toISOString();
      const customData = this.signCustomData({
        s: sessionId,
        u: params.userId,
        exp: expiresAtMs,
      });
      const customDataHash = sha256Hex(customData);

      db.prepare(
        `INSERT INTO reward_sessions
          (id, user_id, provider, ad_unit_path, status, reward_amount, custom_data_hash, provider_transaction_id, ip_prefix, expires_at, verified_at, created_at, updated_at)
         VALUES (?, ?, 'gam', ?, 'PENDING', ?, ?, NULL, ?, ?, NULL, ?, ?)`
      ).run(
        sessionId,
        params.userId,
        adUnitPath,
        policy.rewardCreditsPerAd,
        customDataHash,
        getIpPrefix(params.ipAddress),
        expiresAt,
        nowIso,
        nowIso
      );

      recordAnalyticsEvent('reward_session_created', params.userId, null, {
        rewardAmount: policy.rewardCreditsPerAd,
      });

      return {
        sessionId,
        adUnitPath,
        customData,
        rewardAmount: policy.rewardCreditsPerAd,
        status: 'PENDING',
        expiresAt,
        remainingAdsToday: Math.max(0, policy.rewardDailyCap - usedToday),
        dailyCap: policy.rewardDailyCap,
      };
    });
  }

  /**
   * Returns real server-side status of a reward session after strict owner check.
   * NEVER grants credits from client polling or refresh calls.
   */
  public async getRewardSession(params: {
    sessionId: string;
    userId: string;
    ipAddress?: string;
    requestId?: string;
  }): Promise<RewardSessionStatusResult> {
    const sessionRow = runInTransaction((db) => {
      const nowIso = new Date().toISOString();
      const row = db
        .prepare(
          `SELECT id, user_id, provider, ad_unit_path, status, reward_amount, expires_at, verified_at, created_at, updated_at
           FROM reward_sessions
           WHERE id = ?`
        )
        .get(params.sessionId) as
        | {
            id: string;
            user_id: string;
            provider: string;
            ad_unit_path: string;
            status: RewardSessionStatus;
            reward_amount: number;
            expires_at: string;
            verified_at: string | null;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      if (!row) {
        const err = new Error('Reward session not found.');
        (err as any).statusCode = 404;
        (err as any).code = 'ERR_REWARD_SESSION_NOT_FOUND';
        throw err;
      }

      if (row.user_id !== params.userId) {
        this.logSecurityEvent(db, {
          eventType: 'IDOR_REWARD_SESSION_ATTEMPT',
          severity: 'HIGH',
          userId: params.userId,
          ipAddress: params.ipAddress,
          endpoint: `GET /api/v1/rewards/sessions/${params.sessionId}`,
          requestId: params.requestId,
          details: { targetSessionId: params.sessionId },
        });
        const err = new Error('You do not have permission to access this reward session.');
        (err as any).statusCode = 403;
        (err as any).code = 'ERR_FORBIDDEN';
        throw err;
      }

      // Transition stale PENDING -> EXPIRED (never PENDING -> VERIFIED!)
      if (row.status === 'PENDING' && Date.parse(row.expires_at) <= Date.now()) {
        db.prepare(
          `UPDATE reward_sessions SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status = 'PENDING'`
        ).run(nowIso, row.id);
        row.status = 'EXPIRED';
        row.updated_at = nowIso;
      }

      return row;
    });

    const quota = await entitlementsService.getQuotaStatus(params.userId);
    return {
      sessionId: sessionRow.id,
      status: sessionRow.status,
      provider: sessionRow.provider,
      adUnitPath: sessionRow.ad_unit_path,
      rewardAmount: sessionRow.reward_amount,
      creditsGranted: sessionRow.status === 'VERIFIED' ? sessionRow.reward_amount : 0,
      expiresAt: sessionRow.expires_at,
      verifiedAt: sessionRow.verified_at,
      createdAt: sessionRow.created_at,
      updatedAt: sessionRow.updated_at,
      quota,
    };
  }

  /**
   * Resolves the ECDSA public key PEM for a given `key_id`:
   * 1. Uses `GAM_SSV_PUBLIC_KEY_PEM` if configured (deterministic automated tests / pinned key).
   * 2. Otherwise fetches & caches Google's official verifier keys JSON (`GAM_SSV_KEY_URL`).
   */
  public async resolveVerifierPublicKeyPem(keyId: string): Promise<string | null> {
    const pinnedPem = process.env.GAM_SSV_PUBLIC_KEY_PEM?.trim();
    if (pinnedPem) {
      const pinnedKeyId = process.env.GAM_SSV_TEST_KEY_ID?.trim();
      if (pinnedKeyId && String(keyId) !== pinnedKeyId) {
        return null;
      }
      return normalizePem(pinnedPem);
    }

    const keyUrl = this.getSsvKeyUrl();
    const nowMs = Date.now();

    if (
      this.verifierKeyCache &&
      this.verifierKeyCache.url === keyUrl &&
      nowMs < this.verifierKeyCache.expiresAtMs
    ) {
      const cached = this.verifierKeyCache.keys.get(String(keyId));
      if (cached) return cached;
    }

    // Avoid remote fetch storms on bogus key IDs
    if (
      this.verifierKeyCache &&
      this.verifierKeyCache.url === keyUrl &&
      nowMs - this.lastRemoteFetchAttemptMs < KEY_REFRESH_MIN_INTERVAL_MS
    ) {
      return this.verifierKeyCache.keys.get(String(keyId)) ?? null;
    }

    this.lastRemoteFetchAttemptMs = nowMs;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(keyUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        return this.verifierKeyCache?.keys.get(String(keyId)) ?? null;
      }

      const json = (await response.json()) as {
        keys?: Array<{ keyId?: number | string; pem?: string; base64?: string }>;
      };

      const keysMap = new Map<string, string>();
      if (Array.isArray(json.keys)) {
        for (const k of json.keys) {
          if (k.keyId === undefined || k.keyId === null) continue;
          const idStr = String(k.keyId);
          if (typeof k.pem === 'string' && k.pem.includes('BEGIN PUBLIC KEY')) {
            keysMap.set(idStr, normalizePem(k.pem));
          } else if (typeof k.base64 === 'string' && k.base64.trim().length > 0) {
            const wrapped = k.base64.trim().match(/.{1,64}/g)?.join('\n') || k.base64.trim();
            keysMap.set(idStr, `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`);
          }
        }
      }

      this.verifierKeyCache = {
        url: keyUrl,
        keys: keysMap,
        fetchedAtMs: nowMs,
        expiresAtMs: nowMs + KEY_CACHE_TTL_MS,
      };

      return keysMap.get(String(keyId)) ?? null;
    } catch {
      return this.verifierKeyCache?.keys.get(String(keyId)) ?? null;
    }
  }

  /**
   * Builds canonical payload candidates for ECDSA-SHA256 verification.
   * Per Google Ad Manager SSV spec: GET query string up to (excluding) `&signature=`.
   * For POST JSON callbacks: canonical query strings (Google sorted order & key insertion order)
   * and canonical JSON (excluding `signature` and `key_id`).
   */
  private buildSignatureCandidates(input: ProviderCallbackInput): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const add = (val: string) => {
      if (val && !seen.has(val)) {
        seen.add(val);
        candidates.push(val);
      }
    };

    if (input.method === 'GET') {
      let rawQuery = input.rawQueryString || '';
      if (!rawQuery && input.rawUrl) {
        const qIdx = input.rawUrl.indexOf('?');
        if (qIdx >= 0) {
          rawQuery = input.rawUrl.slice(qIdx + 1);
        }
      }
      if (rawQuery) {
        const sigIdx = rawQuery.indexOf('&signature=');
        if (sigIdx > 0) {
          const rawPrefix = rawQuery.slice(0, sigIdx);
          add(rawPrefix);
          try {
            const decoded = decodeURIComponent(rawPrefix);
            add(decoded);
          } catch {
            // ignore malformed percent encoding
          }
        }
      }
    }

    // Build canonical query string forms from params (excluding signature & key_id)
    const entries = Object.entries(input.params).filter(
      ([k, v]) => k !== 'signature' && k !== 'key_id' && v !== undefined && v !== null
    );

    if (entries.length > 0) {
      // 1. Alphabetically sorted (Google SSV canonical order)
      const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
      add(sorted.map(([k, v]) => `${k}=${String(v)}`).join('&'));
      add(sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&'));

      // 2. Insertion order
      add(entries.map(([k, v]) => `${k}=${String(v)}`).join('&'));

      // 3. Canonical JSON without signature & key_id (for POST JSON callers)
      if (input.method === 'POST') {
        const sortedObj: Record<string, unknown> = {};
        for (const [k, v] of sorted) sortedObj[k] = v;
        add(JSON.stringify(sortedObj));

        const rawObj: Record<string, unknown> = {};
        for (const [k, v] of entries) rawObj[k] = v;
        add(JSON.stringify(rawObj));
      }
    }

    return candidates;
  }

  /**
   * Verifies and processes a Google Ad Manager SSV callback (GET or POST).
   * - Validates ECDSA SHA-256 signature & `key_id`
   * - Validates HMAC-signed `custom_data` -> `sessionId` + `userId`
   * - Enforces UNIQUE `provider_transaction_id` replay protection
   * - Enforces `PENDING` non-expired session & rolling 24h daily cap
   * - Atomically verifies session and appends `REWARD_GRANTED` (+2, +24h) to `credit_ledger`
   * - Duplicate callbacks with same `transaction_id` or already-verified session return 200 idempotently
   *   with `creditsGranted: 0`!
   */
  public async verifyAndProcessProviderCallback(
    input: ProviderCallbackInput
  ): Promise<ProviderCallbackResult> {
    const db = getDb();
    const params = input.params || {};

    const signature = typeof params.signature === 'string' ? params.signature.trim() : '';
    const keyId =
      params.key_id !== undefined && params.key_id !== null ? String(params.key_id).trim() : '';
    const transactionId =
      typeof params.transaction_id === 'string' ? params.transaction_id.trim() : '';
    const customData =
      typeof params.custom_data === 'string' ? params.custom_data.trim() : '';
    const providerUserId =
      typeof params.user_id === 'string' ? params.user_id.trim() : '';
    const adUnit = typeof params.ad_unit === 'string' ? params.ad_unit.trim() : '';
    const adNetwork =
      params.ad_network !== undefined && params.ad_network !== null
        ? String(params.ad_network).trim()
        : '';
    const rewardItem = typeof params.reward_item === 'string' ? params.reward_item.trim() : '';

    // 1. Validate required fields
    if (!signature || !keyId || !transactionId || !customData) {
      this.logSecurityEvent(db, {
        eventType: 'REWARD_CALLBACK_MISSING_FIELDS',
        severity: 'WARN',
        ipAddress: input.ipAddress,
        endpoint: `${input.method} /api/v1/rewards/provider-callback`,
        requestId: input.requestId,
        details: {
          hasSignature: Boolean(signature),
          hasKeyId: Boolean(keyId),
          hasTransactionId: Boolean(transactionId),
          hasCustomData: Boolean(customData),
        },
      });
      const err = new Error(
        'Invalid reward verification callback: signature, key_id, transaction_id, and custom_data are required.'
      );
      (err as any).statusCode = 400;
      (err as any).code = 'ERR_INVALID_SSV_CALLBACK';
      throw err;
    }

    // 2. Resolve ECDSA verifier public key
    const publicKeyPem = await this.resolveVerifierPublicKeyPem(keyId);
    if (!publicKeyPem) {
      this.logSecurityEvent(db, {
        eventType: 'REWARD_UNKNOWN_KEY_ID',
        severity: 'HIGH',
        ipAddress: input.ipAddress,
        endpoint: `${input.method} /api/v1/rewards/provider-callback`,
        requestId: input.requestId,
        details: { keyId, transactionId },
      });
      const err = new Error('Unable to resolve trusted verifier public key for key_id.');
      (err as any).statusCode = 403;
      (err as any).code = 'ERR_UNKNOWN_SSV_KEY_ID';
      throw err;
    }

    // 3. Cryptographically verify ECDSA-SHA256 signature
    const payloadCandidates = this.buildSignatureCandidates(input);
    const sigValid = verifyEcdsaSignature(publicKeyPem, payloadCandidates, signature);
    if (!sigValid) {
      this.logSecurityEvent(db, {
        eventType: 'REWARD_INVALID_SIGNATURE',
        severity: 'HIGH',
        ipAddress: input.ipAddress,
        endpoint: `${input.method} /api/v1/rewards/provider-callback`,
        requestId: input.requestId,
        details: { keyId, transactionId },
      });
      try {
        db.prepare(
          `INSERT OR IGNORE INTO reward_provider_events
            (id, provider_transaction_id, reward_session_id, user_id, key_id, signature_valid, status, raw_summary_json, created_at)
           VALUES (?, ?, NULL, NULL, ?, 0, 'REJECTED_INVALID_SIGNATURE', ?, ?)`
        ).run(
          generatePrefixedId('rpe'),
          `invalid_${transactionId}_${Date.now()}`,
          keyId,
          JSON.stringify({ adNetwork, adUnit, transactionId, rejected: 'invalid_signature' }),
          new Date().toISOString()
        );
      } catch {
        // non-blocking
      }
      const err = new Error('Reward verification signature is invalid.');
      (err as any).statusCode = 403;
      (err as any).code = 'ERR_INVALID_SSV_SIGNATURE';
      throw err;
    }

    // 4. Verify HMAC-signed custom_data binding sessionId + userId
    const parsedCustom = this.verifyCustomData(customData);
    if (!parsedCustom) {
      this.logSecurityEvent(db, {
        eventType: 'REWARD_INVALID_CUSTOM_DATA',
        severity: 'HIGH',
        ipAddress: input.ipAddress,
        endpoint: `${input.method} /api/v1/rewards/provider-callback`,
        requestId: input.requestId,
        details: { keyId, transactionId },
      });
      const err = new Error('Signed custom_data payload is invalid or tampered.');
      (err as any).statusCode = 403;
      (err as any).code = 'ERR_INVALID_CUSTOM_DATA';
      throw err;
    }

    const customDataHash = sha256Hex(customData);
    const redactedSummary = JSON.stringify({
      adNetwork: adNetwork || null,
      adUnit: adUnit || null,
      rewardItem: rewardItem || null,
      method: input.method,
    });

    // 5. Atomic settlement inside SQLite IMMEDIATE transaction
    return runInTransaction((txDb) => {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const policy = entitlementsService.getPolicy(txDb);

      // 5a. Replay check on UNIQUE provider_transaction_id
      const existingEvent = txDb
        .prepare(
          `SELECT id, reward_session_id, user_id, status
           FROM reward_provider_events
           WHERE provider_transaction_id = ?`
        )
        .get(transactionId) as
        | {
            id: string;
            reward_session_id: string | null;
            user_id: string | null;
            status: string;
          }
        | undefined;

      if (existingEvent) {
        this.logSecurityEvent(txDb, {
          eventType: 'REWARD_REPLAY_DETECTED',
          severity: 'WARN',
          userId: existingEvent.user_id || parsedCustom.u,
          ipAddress: input.ipAddress,
          endpoint: `${input.method} /api/v1/rewards/provider-callback`,
          requestId: input.requestId,
          details: {
            transactionId,
            sessionId: existingEvent.reward_session_id || parsedCustom.s,
            originalStatus: existingEvent.status,
          },
        });
        return {
          statusCode: 200,
          processed: false,
          duplicate: true,
          sessionId: existingEvent.reward_session_id || parsedCustom.s,
          transactionId,
          status: existingEvent.status,
          creditsGranted: 0,
          message: 'Duplicate provider transaction already processed; no additional credits granted.',
        };
      }

      // 5b. Load reward session & verify binding
      const session = txDb
        .prepare(
          `SELECT id, user_id, ad_unit_path, status, reward_amount, custom_data_hash, expires_at
           FROM reward_sessions
           WHERE id = ?`
        )
        .get(parsedCustom.s) as
        | {
            id: string;
            user_id: string;
            ad_unit_path: string;
            status: RewardSessionStatus;
            reward_amount: number;
            custom_data_hash: string;
            expires_at: string;
          }
        | undefined;

      if (!session || session.user_id !== parsedCustom.u || session.custom_data_hash !== customDataHash) {
        txDb
          .prepare(
            `INSERT INTO reward_provider_events
              (id, provider_transaction_id, reward_session_id, user_id, key_id, signature_valid, status, raw_summary_json, created_at)
             VALUES (?, ?, ?, ?, ?, 1, 'REJECTED_SESSION_MISMATCH', ?, ?)`
          )
          .run(
            generatePrefixedId('rpe'),
            transactionId,
            parsedCustom.s,
            parsedCustom.u,
            keyId,
            redactedSummary,
            nowIso
          );
        this.logSecurityEvent(txDb, {
          eventType: 'REWARD_SESSION_MISMATCH',
          severity: 'HIGH',
          userId: parsedCustom.u,
          ipAddress: input.ipAddress,
          endpoint: `${input.method} /api/v1/rewards/provider-callback`,
          requestId: input.requestId,
          details: { sessionId: parsedCustom.s, transactionId },
        });
        const err = new Error('Reward session does not match signed callback binding.');
        (err as any).statusCode = 403;
        (err as any).code = 'ERR_REWARD_SESSION_MISMATCH';
        throw err;
      }

      // 5c. Optional provider user_id verification if supplied
      if (providerUserId) {
        const userRow = txDb
          .prepare('SELECT id, public_user_id FROM users WHERE id = ?')
          .get(session.user_id) as { id: string; public_user_id: string } | undefined;
        const matchesInternal = providerUserId === session.user_id;
        const matchesPublic = Boolean(userRow && providerUserId === userRow.public_user_id);
        if (!matchesInternal && !matchesPublic) {
          this.logSecurityEvent(txDb, {
            eventType: 'REWARD_USER_MISMATCH',
            severity: 'HIGH',
            userId: session.user_id,
            ipAddress: input.ipAddress,
            endpoint: `${input.method} /api/v1/rewards/provider-callback`,
            requestId: input.requestId,
            details: { sessionId: session.id, transactionId },
          });
          const err = new Error('Callback user_id does not match reward session owner.');
          (err as any).statusCode = 403;
          (err as any).code = 'ERR_REWARD_USER_MISMATCH';
          throw err;
        }
      }

      // 5d. Already verified session -> idempotent 200 with 0 extra credits
      if (session.status === 'VERIFIED') {
        txDb
          .prepare(
            `INSERT INTO reward_provider_events
              (id, provider_transaction_id, reward_session_id, user_id, key_id, signature_valid, status, raw_summary_json, created_at)
             VALUES (?, ?, ?, ?, ?, 1, 'DUPLICATE_SESSION', ?, ?)`
          )
          .run(
            generatePrefixedId('rpe'),
            transactionId,
            session.id,
            session.user_id,
            keyId,
            redactedSummary,
            nowIso
          );
        this.logSecurityEvent(txDb, {
          eventType: 'REWARD_DUPLICATE_SESSION_CALLBACK',
          severity: 'WARN',
          userId: session.user_id,
          ipAddress: input.ipAddress,
          endpoint: `${input.method} /api/v1/rewards/provider-callback`,
          requestId: input.requestId,
          details: { sessionId: session.id, transactionId },
        });
        return {
          statusCode: 200,
          processed: false,
          duplicate: true,
          sessionId: session.id,
          transactionId,
          status: 'VERIFIED',
          creditsGranted: 0,
          message: 'Reward session was already verified; no additional credits granted.',
        };
      }

      // 5e. Expired or non-PENDING session
      if (session.status !== 'PENDING' || Date.parse(session.expires_at) <= nowMs) {
        if (session.status === 'PENDING') {
          txDb
            .prepare(`UPDATE reward_sessions SET status = 'EXPIRED', updated_at = ? WHERE id = ?`)
            .run(nowIso, session.id);
        }
        txDb
          .prepare(
            `INSERT INTO reward_provider_events
              (id, provider_transaction_id, reward_session_id, user_id, key_id, signature_valid, status, raw_summary_json, created_at)
             VALUES (?, ?, ?, ?, ?, 1, 'REJECTED_SESSION_EXPIRED', ?, ?)`
          )
          .run(
            generatePrefixedId('rpe'),
            transactionId,
            session.id,
            session.user_id,
            keyId,
            redactedSummary,
            nowIso
          );
        const err = new Error('Reward session has expired or is no longer pending.');
        (err as any).statusCode = 409;
        (err as any).code = 'ERR_REWARD_SESSION_EXPIRED';
        throw err;
      }

      // 5f. Rolling 24h daily cap enforcement (default 3 verified ads / 24h)
      const verifiedToday = entitlementsService.getVerifiedRewardAdsCount24h(
        session.user_id,
        nowMs,
        txDb
      );
      if (verifiedToday >= policy.rewardDailyCap) {
        txDb
          .prepare(`UPDATE reward_sessions SET status = 'REJECTED', updated_at = ? WHERE id = ?`)
          .run(nowIso, session.id);
        txDb
          .prepare(
            `INSERT INTO reward_provider_events
              (id, provider_transaction_id, reward_session_id, user_id, key_id, signature_valid, status, raw_summary_json, created_at)
             VALUES (?, ?, ?, ?, ?, 1, 'REJECTED_DAILY_CAP', ?, ?)`
          )
          .run(
            generatePrefixedId('rpe'),
            transactionId,
            session.id,
            session.user_id,
            keyId,
            redactedSummary,
            nowIso
          );
        this.logSecurityEvent(txDb, {
          eventType: 'REWARD_DAILY_CAP_EXCEEDED',
          severity: 'WARN',
          userId: session.user_id,
          ipAddress: input.ipAddress,
          endpoint: `${input.method} /api/v1/rewards/provider-callback`,
          requestId: input.requestId,
          details: {
            sessionId: session.id,
            transactionId,
            verifiedToday,
            dailyCap: policy.rewardDailyCap,
          },
        });
        const err = new Error('Daily rewarded ad verification limit has been reached.');
        (err as any).statusCode = 409;
        (err as any).code = 'ERR_REWARD_DAILY_CAP_REACHED';
        throw err;
      }

      // 5g. Atomically burn transaction_id, mark session VERIFIED, and append immutable REWARD_GRANTED
      // Always use server-authoritative reward_amount from session/policy (never blindly trust arbitrary client/query inflation)
      const grantAmount = Math.max(1, session.reward_amount || policy.rewardCreditsPerAd);

      txDb
        .prepare(
          `INSERT INTO reward_provider_events
            (id, provider_transaction_id, reward_session_id, user_id, key_id, signature_valid, status, raw_summary_json, created_at)
           VALUES (?, ?, ?, ?, ?, 1, 'VERIFIED', ?, ?)`
        )
        .run(
          generatePrefixedId('rpe'),
          transactionId,
          session.id,
          session.user_id,
          keyId,
          redactedSummary,
          nowIso
        );

      const updateRes = txDb
        .prepare(
          `UPDATE reward_sessions
           SET status = 'VERIFIED', provider_transaction_id = ?, verified_at = ?, updated_at = ?
           WHERE id = ? AND status = 'PENDING'`
        )
        .run(transactionId, nowIso, nowIso, session.id);

      if (Number(updateRes.changes) !== 1) {
        const err = new Error('Reward session state changed concurrently.');
        (err as any).statusCode = 409;
        (err as any).code = 'ERR_REWARD_CONCURRENT_CONFLICT';
        throw err;
      }

      const grant = entitlementsService.grantRewardCreditsInTx(txDb, {
        userId: session.user_id,
        amount: grantAmount,
        rewardSessionId: session.id,
        expiryHours: policy.rewardExpiryHours,
        reason: `Verified rewarded advertisement (+${grantAmount} individual credits)`,
        nowMs,
      });

      recordAnalyticsEvent('reward_granted', session.user_id, null, {
        amount: grantAmount,
        expiryHours: policy.rewardExpiryHours,
      });

      return {
        statusCode: 200,
        processed: true,
        duplicate: false,
        sessionId: session.id,
        transactionId,
        status: 'VERIFIED',
        creditsGranted: grantAmount,
        expiresAt: grant.expiresAt,
        extraCreditsRemaining: grant.extraCreditsRemaining,
        totalAvailableIndividual: grant.totalAvailableIndividual,
        message: `Verified reward granted (+${grantAmount} individual credits, expires ${grant.expiresAt}).`,
      };
    });
  }
}

export const rewardsService = new RewardsService();
