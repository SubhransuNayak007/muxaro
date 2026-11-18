/**
 * Project MUXARO - Administrator Control Centre Service
 *
 * Provides strictly DB-derived, redacted administrative operations:
 * - Unified support search (MXR-..., MXB-..., MXJ-..., req_...)
 * - User listing, suspension, restoration, and session revocation
 * - Live platform settings management (system_settings) with bounds validation
 * - Rewarded Ads provider telemetry, replay/fraud monitoring
 * - Real SQLite-derived business & queue analytics (DAU/MAU, retention, funnel, tier latency)
 * - Immutable admin audit trail (`admin_audit_logs`) & security event feed (`security_events`)
 */

import { getDb, runInTransaction, DEFAULT_SYSTEM_SETTINGS } from '../db/database.js';
import { generatePrefixedId } from './id.service.js';
import { queueService } from './queue.service.js';
import { redactEmail, redactSensitiveData } from './ratelimit.service.js';

export interface AdminActor {
  userId: string;
  publicUserId: string;
  email?: string;
}

export interface PlatformSettingsMap {
  baseIndividualLimit: number;
  guestIndividualLimit: number;
  premiumIndividualLimit: number;
  basePlaylistLimit: number;
  guestPlaylistLimit: number;
  premiumPlaylistLimit: number;
  rewardCreditsPerAd: number;
  rewardDailyCap: number;
  rewardExpiryHours: number;
  guestMaxConcurrent: number;
  freeMaxConcurrent: number;
  premiumMaxConcurrent: number;
  maxUploadSizeMb: number;
  maxPlaylistItems: number;
  rewardedAdsEnabled: boolean;
  artifactRetentionMinutes: number;
}

interface SettingSpec {
  dbKey: string;
  camelKey: keyof PlatformSettingsMap;
  aliases?: readonly string[];
  type: 'number' | 'boolean';
  min?: number;
  max?: number;
  defaultValue: number | boolean;
  description: string;
}

const SETTING_SPECS: readonly SettingSpec[] = [
  { dbKey: 'base_individual_limit', camelKey: 'baseIndividualLimit', aliases: ['baseVideoAllowance'], type: 'number', min: 1, max: 1000, defaultValue: 10, description: 'Free registered user individual jobs per rolling 24h' },
  { dbKey: 'guest_individual_limit', camelKey: 'guestIndividualLimit', aliases: ['guestDailyAllowance'], type: 'number', min: 0, max: 100, defaultValue: 3, description: 'Guest individual jobs per rolling 24h' },
  { dbKey: 'premium_individual_limit', camelKey: 'premiumIndividualLimit', aliases: ['premiumVideoAllowance'], type: 'number', min: 1, max: 10000, defaultValue: 100, description: 'Premium user individual jobs per rolling 24h' },
  { dbKey: 'base_playlist_limit', camelKey: 'basePlaylistLimit', aliases: ['playlistAllowance'], type: 'number', min: 0, max: 100, defaultValue: 1, description: 'Free registered user playlist jobs per rolling 24h' },
  { dbKey: 'guest_playlist_limit', camelKey: 'guestPlaylistLimit', type: 'number', min: 0, max: 50, defaultValue: 0, description: 'Guest playlist jobs per rolling 24h' },
  { dbKey: 'premium_playlist_limit', camelKey: 'premiumPlaylistLimit', type: 'number', min: 0, max: 500, defaultValue: 10, description: 'Premium user playlist jobs per rolling 24h' },
  { dbKey: 'reward_credits_per_ad', camelKey: 'rewardCreditsPerAd', type: 'number', min: 1, max: 20, defaultValue: 2, description: 'Extra individual job credits granted per verified rewarded ad' },
  { dbKey: 'reward_daily_cap', camelKey: 'rewardDailyCap', type: 'number', min: 0, max: 20, defaultValue: 3, description: 'Maximum verified rewarded ads per user per rolling 24h' },
  { dbKey: 'reward_expiry_hours', camelKey: 'rewardExpiryHours', type: 'number', min: 1, max: 720, defaultValue: 24, description: 'Rolling expiration window in hours for earned reward credits' },
  { dbKey: 'guest_max_concurrent', camelKey: 'guestMaxConcurrent', aliases: ['guestConcurrency'], type: 'number', min: 1, max: 10, defaultValue: 1, description: 'Max concurrent active jobs for guest tier' },
  { dbKey: 'free_max_concurrent', camelKey: 'freeMaxConcurrent', aliases: ['freeConcurrency'], type: 'number', min: 1, max: 20, defaultValue: 2, description: 'Max concurrent active jobs for free registered tier' },
  { dbKey: 'premium_max_concurrent', camelKey: 'premiumMaxConcurrent', aliases: ['premiumConcurrency'], type: 'number', min: 1, max: 50, defaultValue: 5, description: 'Max concurrent active jobs for premium tier' },
  { dbKey: 'max_upload_size_mb', camelKey: 'maxUploadSizeMb', type: 'number', min: 10, max: 10240, defaultValue: 2048, description: 'Maximum local file upload size in MB' },
  { dbKey: 'max_playlist_items', camelKey: 'maxPlaylistItems', type: 'number', min: 1, max: 200, defaultValue: 50, description: 'Maximum items allowed in a playlist batch job' },
  { dbKey: 'rewarded_ads_enabled', camelKey: 'rewardedAdsEnabled', type: 'boolean', defaultValue: true, description: 'Global feature flag enabling rewarded ads when GAM is configured' },
  { dbKey: 'artifact_retention_minutes', camelKey: 'artifactRetentionMinutes', type: 'number', min: 5, max: 1440, defaultValue: 60, description: 'Completed artifact retention duration in minutes' },
];

const SPEC_BY_ANY_KEY = new Map<string, SettingSpec>();
for (const spec of SETTING_SPECS) {
  SPEC_BY_ANY_KEY.set(spec.dbKey, spec);
  SPEC_BY_ANY_KEY.set(spec.camelKey, spec);
  for (const alias of spec.aliases ?? []) {
    SPEC_BY_ANY_KEY.set(alias, spec);
  }
}

function computePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1)
  );
  return Math.round(sortedValues[idx]);
}

function safeJsonParse(raw?: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class AdminService {
  /**
   * Appends an immutable record to `admin_audit_logs`.
   */
  public recordAuditLog(params: {
    adminUserId: string;
    adminPublicId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    requestId?: string | null;
  }): string {
    const id = generatePrefixedId('aud', 10);
    const now = new Date().toISOString();
    const db = getDb();

    const safeBefore =
      params.before !== undefined ? JSON.stringify(redactSensitiveData(params.before)) : null;
    const safeAfter =
      params.after !== undefined ? JSON.stringify(redactSensitiveData(params.after)) : null;

    db.prepare(
      `INSERT INTO admin_audit_logs
       (id, admin_user_id, admin_public_id, action, target_type, target_id, before_json, after_json, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.adminUserId,
      params.adminPublicId ?? null,
      params.action,
      params.targetType,
      params.targetId ?? null,
      safeBefore,
      safeAfter,
      params.requestId ?? null,
      now
    );

    return id;
  }

  /**
   * Optional idempotent admin role bootstrap controlled strictly via `MUXARO_ADMIN_EMAIL` env var
   * (supports single email or comma-separated list).
   * Never creates hardcoded passwords and never bypasses TOTP MFA.
   */
  public syncBootstrapAdminFromEnv(): { promoted: boolean; publicUserIds: string[] } {
    const rawList = process.env.MUXARO_ADMIN_EMAIL?.trim() || '';
    if (!rawList) return { promoted: false, publicUserIds: [] };

    const emails = rawList
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (emails.length === 0) return { promoted: false, publicUserIds: [] };

    const db = getDb();
    const promotedIds: string[] = [];
    const now = new Date().toISOString();

    for (const email of emails) {
      const user = db
        .prepare(
          `SELECT id, public_user_id, role, account_status FROM users WHERE lower(email) = ? AND deleted_at IS NULL`
        )
        .get(email) as
        | { id: string; public_user_id: string; role: string; account_status: string }
        | undefined;

      if (!user || user.role.toUpperCase() === 'ADMIN') {
        continue;
      }

      db.prepare(`UPDATE users SET role = 'ADMIN', updated_at = ? WHERE id = ?`).run(now, user.id);

      this.recordAuditLog({
        adminUserId: 'system_bootstrap',
        adminPublicId: 'SYSTEM',
        action: 'ADMIN_BOOTSTRAP_PROMOTE',
        targetType: 'user',
        targetId: user.public_user_id,
        before: { role: user.role },
        after: { role: 'ADMIN', source: 'MUXARO_ADMIN_EMAIL' },
      });

      promotedIds.push(user.public_user_id);
    }

    return { promoted: promotedIds.length > 0, publicUserIds: promotedIds };
  }

  /**
   * Unified Support Search by Public User ID (MXR-...), Batch ID (MXB-...), Job ID (MXJ-...), or Request ID (req_...).
   */
  public searchSupport(rawQuery: string) {
    const q = rawQuery.trim();
    if (!q) {
      return {
        query: '',
        matchType: 'NONE',
        users: [],
        batches: [],
        jobs: [],
        securityEvents: [],
        auditLogs: [],
      };
    }

    const db = getDb();
    const upper = q.toUpperCase();
    const likePattern = `%${q}%`;

    // 1. Search Users (Public ID MXR-..., internal UUID, or email)
    const userRows = db
      .prepare(
        `SELECT id, public_user_id, email, email_verified, display_name, role, tier, account_status, mfa_enabled, created_at, updated_at
         FROM users
         WHERE deleted_at IS NULL
           AND (upper(public_user_id) = ? OR id = ? OR lower(email) LIKE lower(?))
         ORDER BY created_at DESC
         LIMIT 20`
      )
      .all(upper, q, likePattern) as Array<Record<string, any>>;

    const users = userRows.map((u) => this.enrichUserSummary(u));

    // 2. Search Batches (MXB-...)
    const batchRows = db
      .prepare(
        `SELECT b.id, b.owner_user_id, u.public_user_id, b.owner_tier, b.title, b.status,
                b.total_items, b.completed_items, b.failed_items, b.cancelled_items, b.progress,
                b.error_message, b.created_at, b.updated_at, b.completed_at, b.expires_at
         FROM batches b
         LEFT JOIN users u ON u.id = b.owner_user_id
         WHERE upper(b.id) = ? OR upper(b.id) LIKE upper(?) OR upper(u.public_user_id) = ?
         ORDER BY b.created_at DESC
         LIMIT 20`
      )
      .all(upper, likePattern, upper) as Array<Record<string, any>>;

    const batches = batchRows.map((b) => ({
      batchId: b.id,
      ownerPublicUserId: b.public_user_id || 'GUEST',
      ownerTier: b.owner_tier,
      title: b.title,
      status: b.status,
      totalItems: b.total_items,
      completedItems: b.completed_items,
      failedItems: b.failed_items,
      cancelledItems: b.cancelled_items,
      progress: b.progress,
      errorMessage: b.error_message || null,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
      completedAt: b.completed_at || null,
      expiresAt: b.expires_at || null,
    }));

    // 3. Search Processing Jobs (MXJ-..., batch_id, request_id, or owner MXR-...)
    const jobRows = db
      .prepare(
        `SELECT j.id, j.owner_user_id, u.public_user_id, j.owner_tier, j.batch_id, j.item_number,
                j.input_title, j.operation, j.target_format, j.target_resolution,
                j.processing_lane, j.queue_class, j.status, j.progress, j.stage, j.stage_message,
                j.request_id, j.attempts, j.queue_wait_ms, j.processing_ms,
                j.error_code, j.error_message, j.created_at, j.updated_at, j.completed_at
         FROM processing_jobs j
         LEFT JOIN users u ON u.id = j.owner_user_id
         WHERE upper(j.id) = ?
            OR upper(j.id) LIKE upper(?)
            OR j.request_id = ?
            OR upper(j.batch_id) = ?
            OR upper(u.public_user_id) = ?
         ORDER BY j.created_at DESC
         LIMIT 30`
      )
      .all(upper, likePattern, q, upper, upper) as Array<Record<string, any>>;

    const jobs = jobRows.map((j) => ({
      jobId: j.id,
      ownerPublicUserId: j.public_user_id || 'GUEST',
      ownerTier: j.owner_tier,
      batchId: j.batch_id || null,
      itemNumber: j.item_number || null,
      inputTitle: j.input_title || null,
      operation: j.operation,
      targetFormat: j.target_format,
      targetResolution: j.target_resolution || null,
      processingLane: j.processing_lane,
      queueClass: j.queue_class,
      status: j.status,
      progress: j.progress,
      stage: j.stage,
      stageMessage: j.stage_message,
      requestId: j.request_id || null,
      attempts: j.attempts,
      queueWaitMs: j.queue_wait_ms ?? null,
      processingMs: j.processing_ms ?? null,
      errorCode: j.error_code || null,
      errorMessage: j.error_message || null,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
      completedAt: j.completed_at || null,
    }));

    // 4. Search Security Events by request_id or public_user_id
    const secRows = db
      .prepare(
        `SELECT id, event_type, severity, public_user_id, ip_prefix, endpoint, request_id, details_json, created_at
         FROM security_events
         WHERE request_id = ? OR upper(public_user_id) = ?
         ORDER BY created_at DESC
         LIMIT 20`
      )
      .all(q, upper) as Array<Record<string, any>>;

    const securityEvents = secRows.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      severity: e.severity,
      publicUserId: e.public_user_id || null,
      ipPrefix: e.ip_prefix || 'unknown',
      endpoint: e.endpoint || null,
      requestId: e.request_id || null,
      details: safeJsonParse(e.details_json),
      createdAt: e.created_at,
    }));

    // 5. Search Audit Logs by request_id or target_id
    const auditRows = db
      .prepare(
        `SELECT id, admin_public_id, action, target_type, target_id, before_json, after_json, request_id, created_at
         FROM admin_audit_logs
         WHERE request_id = ? OR upper(target_id) = ?
         ORDER BY created_at DESC
         LIMIT 20`
      )
      .all(q, upper) as Array<Record<string, any>>;

    const auditLogs = auditRows.map((a) => ({
      id: a.id,
      adminPublicId: a.admin_public_id || 'SYSTEM',
      action: a.action,
      targetType: a.target_type,
      targetId: a.target_id || null,
      before: safeJsonParse(a.before_json),
      after: safeJsonParse(a.after_json),
      requestId: a.request_id || null,
      createdAt: a.created_at,
    }));

    let matchType = 'MULTI';
    if (upper.startsWith('MXR-')) matchType = 'USER';
    else if (upper.startsWith('MXB-')) matchType = 'BATCH';
    else if (upper.startsWith('MXJ-')) matchType = 'JOB';
    else if (q.startsWith('req_')) matchType = 'REQUEST';

    return {
      query: q,
      matchType,
      users,
      batches,
      jobs,
      securityEvents,
      auditLogs,
    };
  }

  /**
   * Lists registered users with real usage, active sessions, credits, and abuse flags.
   */
  public listUsers(params: {
    page?: number;
    limit?: number;
    status?: string;
    tier?: string;
    search?: string;
  }) {
    const db = getDb();
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params.limit || 25)));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = ['deleted_at IS NULL'];
    const args: Array<string | number> = [];

    if (params.status && params.status.trim()) {
      whereClauses.push('upper(account_status) = upper(?)');
      args.push(params.status.trim());
    }
    if (params.tier && params.tier.trim()) {
      whereClauses.push('upper(tier) = upper(?)');
      args.push(params.tier.trim());
    }
    if (params.search && params.search.trim()) {
      const s = `%${params.search.trim()}%`;
      whereClauses.push(
        '(upper(public_user_id) LIKE upper(?) OR lower(email) LIKE lower(?) OR lower(COALESCE(display_name, \'\')) LIKE lower(?))'
      );
      args.push(s, s, s);
    }

    const whereSql = whereClauses.join(' AND ');
    const countRow = db
      .prepare(`SELECT COUNT(*) AS total FROM users WHERE ${whereSql}`)
      .get(...args) as { total: number };

    const rows = db
      .prepare(
        `SELECT id, public_user_id, email, email_verified, display_name, role, tier, account_status, mfa_enabled, created_at, updated_at
         FROM users
         WHERE ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...args, limit, offset) as Array<Record<string, any>>;

    return {
      page,
      limit,
      total: countRow?.total ?? 0,
      users: rows.map((r) => this.enrichUserSummary(r)),
    };
  }

  /**
   * Suspends a user account by Public User ID (`MXR-...`), revokes all active sessions, and logs an immutable audit entry.
   */
  public suspendUser(
    publicUserId: string,
    actor: AdminActor,
    reason: string = 'Suspended by administrator',
    requestId?: string
  ) {
    const normalizedId = publicUserId.trim().toUpperCase();
    return runInTransaction((db) => {
      const user = db
        .prepare(
          `SELECT id, public_user_id, role, tier, account_status FROM users WHERE upper(public_user_id) = ? AND deleted_at IS NULL`
        )
        .get(normalizedId) as
        | { id: string; public_user_id: string; role: string; tier: string; account_status: string }
        | undefined;

      if (!user) {
        const err = new Error(`User ${publicUserId} not found`);
        (err as any).statusCode = 404;
        (err as any).code = 'ERR_USER_NOT_FOUND';
        throw err;
      }

      if (user.id === actor.userId) {
        const err = new Error('Administrators cannot suspend their own account');
        (err as any).statusCode = 400;
        (err as any).code = 'ERR_INVALID_ACTION';
        throw err;
      }

      const now = new Date().toISOString();
      db.prepare(`UPDATE users SET account_status = 'SUSPENDED', updated_at = ? WHERE id = ?`).run(
        now,
        user.id
      );

      const sessionRes = db
        .prepare(
          `UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`
        )
        .run(now, user.id);

      const auditId = this.recordAuditLog({
        adminUserId: actor.userId,
        adminPublicId: actor.publicUserId,
        action: 'USER_SUSPEND',
        targetType: 'user',
        targetId: user.public_user_id,
        before: { accountStatus: user.account_status },
        after: {
          accountStatus: 'SUSPENDED',
          reason: reason.slice(0, 240),
          revokedSessions: Number(sessionRes.changes ?? 0),
        },
        requestId,
      });

      return {
        publicUserId: user.public_user_id,
        accountStatus: 'SUSPENDED',
        revokedSessions: Number(sessionRes.changes ?? 0),
        auditId,
        updatedAt: now,
      };
    });
  }

  /**
   * Restores a suspended user account by Public User ID (`MXR-...`) and logs an immutable audit entry.
   */
  public restoreUser(
    publicUserId: string,
    actor: AdminActor,
    reason: string = 'Restored by administrator',
    requestId?: string
  ) {
    const normalizedId = publicUserId.trim().toUpperCase();
    return runInTransaction((db) => {
      const user = db
        .prepare(
          `SELECT id, public_user_id, account_status FROM users WHERE upper(public_user_id) = ? AND deleted_at IS NULL`
        )
        .get(normalizedId) as
        | { id: string; public_user_id: string; account_status: string }
        | undefined;

      if (!user) {
        const err = new Error(`User ${publicUserId} not found`);
        (err as any).statusCode = 404;
        (err as any).code = 'ERR_USER_NOT_FOUND';
        throw err;
      }

      const now = new Date().toISOString();
      db.prepare(`UPDATE users SET account_status = 'ACTIVE', updated_at = ? WHERE id = ?`).run(
        now,
        user.id
      );

      const auditId = this.recordAuditLog({
        adminUserId: actor.userId,
        adminPublicId: actor.publicUserId,
        action: 'USER_RESTORE',
        targetType: 'user',
        targetId: user.public_user_id,
        before: { accountStatus: user.account_status },
        after: { accountStatus: 'ACTIVE', reason: reason.slice(0, 240) },
        requestId,
      });

      return {
        publicUserId: user.public_user_id,
        accountStatus: 'ACTIVE',
        auditId,
        updatedAt: now,
      };
    });
  }

  /**
   * Revokes all active sessions for a user by Public User ID (`MXR-...`) and writes an audit log entry.
   */
  public revokeUserSessions(
    publicUserId: string,
    actor: AdminActor,
    reason: string = 'Sessions revoked by administrator',
    requestId?: string
  ) {
    const normalizedId = publicUserId.trim().toUpperCase();
    return runInTransaction((db) => {
      const user = db
        .prepare(
          `SELECT id, public_user_id FROM users WHERE upper(public_user_id) = ? AND deleted_at IS NULL`
        )
        .get(normalizedId) as { id: string; public_user_id: string } | undefined;

      if (!user) {
        const err = new Error(`User ${publicUserId} not found`);
        (err as any).statusCode = 404;
        (err as any).code = 'ERR_USER_NOT_FOUND';
        throw err;
      }

      const now = new Date().toISOString();
      const res = db
        .prepare(
          `UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`
        )
        .run(now, user.id);

      const revokedCount = Number(res.changes ?? 0);

      const auditId = this.recordAuditLog({
        adminUserId: actor.userId,
        adminPublicId: actor.publicUserId,
        action: 'USER_REVOKE_SESSIONS',
        targetType: 'user',
        targetId: user.public_user_id,
        before: { activeSessionsRevoked: revokedCount },
        after: { revokedSessions: revokedCount, reason: reason.slice(0, 240) },
        requestId,
      });

      return {
        publicUserId: user.public_user_id,
        revokedSessions: revokedCount,
        auditId,
        revokedAt: now,
      };
    });
  }

  /**
   * Reads all configurable platform settings from `system_settings`.
   */
  public getSettings(): {
    settings: PlatformSettingsMap;
    raw: Record<string, string>;
    items: Array<{
      key: string;
      camelKey: string;
      value: number | boolean;
      description: string;
      updatedBy: string;
      updatedAt: string;
    }>;
  } {
    const db = getDb();
    const rows = db
      .prepare(`SELECT key, value, description, updated_by, updated_at FROM system_settings`)
      .all() as Array<{
      key: string;
      value: string;
      description?: string;
      updated_by?: string;
      updated_at?: string;
    }>;

    const rowMap = new Map(rows.map((r) => [r.key, r]));
    const raw: Record<string, string> = {};
    const settings: Record<string, number | boolean> = {};
    const items: Array<{
      key: string;
      camelKey: string;
      value: number | boolean;
      description: string;
      updatedBy: string;
      updatedAt: string;
    }> = [];

    for (const spec of SETTING_SPECS) {
      const row = rowMap.get(spec.dbKey);
      let parsed: number | boolean = spec.defaultValue;
      if (row) {
        if (spec.type === 'boolean') {
          parsed = row.value.toLowerCase() === 'true' || row.value === '1';
        } else {
          const n = Number(row.value);
          if (Number.isFinite(n)) parsed = n;
        }
      }
      raw[spec.dbKey] = String(parsed);
      settings[spec.camelKey] = parsed;
      for (const alias of spec.aliases ?? []) {
        settings[alias] = parsed;
      }
      items.push({
        key: spec.dbKey,
        camelKey: spec.camelKey,
        value: parsed,
        description: row?.description || spec.description,
        updatedBy: row?.updated_by || 'system',
        updatedAt: row?.updated_at || new Date(0).toISOString(),
      });
    }

    return {
      settings: settings as unknown as PlatformSettingsMap,
      raw,
      items,
    };
  }

  /**
   * Updates one or more platform settings with strict range/type validation and immutable audit logging.
   * Accepts both snake_case DB keys and camelCase keys.
   */
  public updateSettings(
    patch: Record<string, unknown>,
    actor: AdminActor,
    requestId?: string
  ) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      const err = new Error('Settings patch must be a JSON object');
      (err as any).statusCode = 400;
      (err as any).code = 'ERR_INVALID_SETTINGS';
      throw err;
    }

    const beforeSnapshot = this.getSettings().settings;
    const validatedUpdates: Array<{ spec: SettingSpec; newValue: number | boolean }> = [];

    for (const [incomingKey, rawVal] of Object.entries(patch)) {
      const spec = SPEC_BY_ANY_KEY.get(incomingKey);

      if (!spec) {
        const err = new Error(`Unsupported setting key: ${incomingKey}`);
        (err as any).statusCode = 400;
        (err as any).code = 'ERR_INVALID_SETTING_KEY';
        throw err;
      }

      if (spec.type === 'boolean') {
        let boolVal: boolean;
        if (typeof rawVal === 'boolean') {
          boolVal = rawVal;
        } else if (rawVal === 'true' || rawVal === '1' || rawVal === 1) {
          boolVal = true;
        } else if (rawVal === 'false' || rawVal === '0' || rawVal === 0) {
          boolVal = false;
        } else {
          const err = new Error(`Setting ${incomingKey} must be a boolean`);
          (err as any).statusCode = 400;
          (err as any).code = 'ERR_INVALID_SETTING_VALUE';
          throw err;
        }
        validatedUpdates.push({ spec, newValue: boolVal });
      } else {
        const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal);
        if (!Number.isFinite(numVal) || !Number.isInteger(numVal)) {
          const err = new Error(`Setting ${incomingKey} must be an integer`);
          (err as any).statusCode = 400;
          (err as any).code = 'ERR_INVALID_SETTING_VALUE';
          throw err;
        }
        if (
          (spec.min !== undefined && numVal < spec.min) ||
          (spec.max !== undefined && numVal > spec.max)
        ) {
          const err = new Error(
            `Setting ${incomingKey} must be between ${spec.min} and ${spec.max}`
          );
          (err as any).statusCode = 400;
          (err as any).code = 'ERR_INVALID_SETTING_RANGE';
          throw err;
        }
        validatedUpdates.push({ spec, newValue: numVal });
      }
    }

    if (validatedUpdates.length === 0) {
      const err = new Error('No valid settings provided in update payload');
      (err as any).statusCode = 400;
      (err as any).code = 'ERR_EMPTY_SETTINGS_PATCH';
      throw err;
    }

    const now = new Date().toISOString();
    const auditId = runInTransaction((db) => {
      const upsertStmt = db.prepare(
        `INSERT INTO system_settings (key, value, description, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`
      );

      const changedBefore: Record<string, unknown> = {};
      const changedAfter: Record<string, unknown> = {};

      for (const { spec, newValue } of validatedUpdates) {
        const prev = beforeSnapshot[spec.camelKey];
        changedBefore[spec.dbKey] = prev;
        changedAfter[spec.dbKey] = newValue;
        const defaultDesc =
          DEFAULT_SYSTEM_SETTINGS.find((s) => s.key === spec.dbKey)?.description ??
          spec.description;
        upsertStmt.run(spec.dbKey, String(newValue), defaultDesc, actor.publicUserId, now);
      }

      return this.recordAuditLog({
        adminUserId: actor.userId,
        adminPublicId: actor.publicUserId,
        action: 'SETTINGS_UPDATE',
        targetType: 'system_settings',
        targetId: validatedUpdates.map((u) => u.spec.dbKey).join(','),
        before: changedBefore,
        after: changedAfter,
        requestId,
      });
    });

    return {
      ...this.getSettings(),
      auditId,
      updatedAt: now,
    };
  }

  /**
   * Returns rewarded-ad provider status, verified/rejected counts, and replay/fraud telemetry.
   */
  public getRewardsOverview() {
    const db = getDb();
    const settings = this.getSettings().settings;
    const adUnitPath = process.env.GAM_REWARDED_AD_UNIT_PATH?.trim() || null;
    const testKeyConfigured = Boolean(process.env.GAM_SSV_PUBLIC_KEY_PEM?.trim());
    const ssvKeyUrl =
      process.env.GAM_SSV_KEY_URL?.trim() ||
      'https://www.gstatic.com/admob/reward/verifier-keys.json';
    const envEnabled = process.env.REWARDED_ADS_ENABLED !== 'false';
    const configured = Boolean(adUnitPath);
    const active = settings.rewardedAdsEnabled && envEnabled && configured;

    const sessionCounts = db
      .prepare(`SELECT status, COUNT(*) AS cnt FROM reward_sessions GROUP BY status`)
      .all() as Array<{ status: string; cnt: number }>;

    const sessionMap: Record<string, number> = {};
    for (const row of sessionCounts) {
      sessionMap[row.status] = Number(row.cnt);
    }

    const eventCounts = db
      .prepare(
        `SELECT status, signature_valid, COUNT(*) AS cnt
         FROM reward_provider_events
         GROUP BY status, signature_valid`
      )
      .all() as Array<{ status: string; signature_valid: number; cnt: number }>;

    let validCallbacks = 0;
    let rejectedCallbacks = 0;
    let duplicateReplays = 0;
    for (const row of eventCounts) {
      const c = Number(row.cnt);
      const st = String(row.status || '').toUpperCase();
      if (st === 'DUPLICATE' || st === 'REPLAY') {
        duplicateReplays += c;
      } else if (row.signature_valid === 1 && (st === 'VERIFIED' || st === 'GRANTED' || st === 'PROCESSED')) {
        validCallbacks += c;
      } else {
        rejectedCallbacks += c;
      }
    }

    const since24h = new Date(Date.now() - 86_400_000).toISOString();
    const creditsRow = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN entry_type = 'REWARD_GRANTED' THEN delta ELSE 0 END), 0) AS total_earned,
           COALESCE(SUM(CASE WHEN entry_type = 'REWARD_GRANTED' AND created_at >= ? THEN delta ELSE 0 END), 0) AS earned_24h,
           COALESCE(SUM(CASE WHEN entry_type = 'CREDIT_EXPIRED' THEN ABS(delta) ELSE 0 END), 0) AS total_expired
         FROM credit_ledger`
      )
      .get(since24h) as { total_earned: number; earned_24h: number; total_expired: number };

    const replaySecurityEvents = db
      .prepare(
        `SELECT id, event_type, severity, public_user_id, ip_prefix, endpoint, request_id, details_json, created_at
         FROM security_events
         WHERE event_type IN ('REWARD_REPLAY', 'RATE_LIMIT_SPIKE')
           AND (endpoint LIKE '%reward%' OR event_type = 'REWARD_REPLAY')
         ORDER BY created_at DESC
         LIMIT 25`
      )
      .all() as Array<Record<string, any>>;

    const recentProviderEvents = db
      .prepare(
        `SELECT e.id, e.provider_transaction_id, e.reward_session_id, u.public_user_id,
                e.key_id, e.signature_valid, e.status, e.created_at
         FROM reward_provider_events e
         LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.created_at DESC
         LIMIT 25`
      )
      .all() as Array<Record<string, any>>;

    const replayCount =
      duplicateReplays +
      replaySecurityEvents.filter((e) => e.event_type === 'REWARD_REPLAY').length;
    const totalSessions = Object.values(sessionMap).reduce((a, b) => a + b, 0);

    return {
      // Top-level AdminRewardsSummary contract fields
      enabled: settings.rewardedAdsEnabled && envEnabled,
      configured,
      adUnitPath,
      totalSessions,
      verifiedRewards: sessionMap.VERIFIED ?? 0,
      rejectedRewards: (sessionMap.REJECTED ?? 0) + rejectedCallbacks,
      duplicateReplays: replayCount,
      fraudFlags: replaySecurityEvents.length,
      creditsGranted24h: Number(creditsRow?.earned_24h ?? 0),
      // Detailed operational breakdown
      provider: {
        name: 'Google Ad Manager (GAM SSV)',
        enabledBySettings: settings.rewardedAdsEnabled,
        enabledByEnv: envEnabled,
        configured,
        active,
        adUnitPathConfigured: Boolean(adUnitPath),
        ssvKeyUrl,
        customVerifierKeyConfigured: testKeyConfigured,
        creditsPerAd: settings.rewardCreditsPerAd,
        dailyCap: settings.rewardDailyCap,
        expiryHours: settings.rewardExpiryHours,
      },
      sessions: {
        pending: sessionMap.PENDING ?? 0,
        verified: sessionMap.VERIFIED ?? 0,
        rejected: sessionMap.REJECTED ?? 0,
        expired: sessionMap.EXPIRED ?? 0,
        total: totalSessions,
      },
      callbacks: {
        valid: validCallbacks,
        rejected: rejectedCallbacks,
        duplicateReplays: replayCount,
      },
      credits: {
        earnedLast24h: Number(creditsRow?.earned_24h ?? 0),
        earnedTotal: Number(creditsRow?.total_earned ?? 0),
        expiredTotal: Number(creditsRow?.total_expired ?? 0),
      },
      recentProviderEvents: recentProviderEvents.map((e) => ({
        id: e.id,
        transactionId: e.provider_transaction_id,
        rewardSessionId: e.reward_session_id,
        publicUserId: e.public_user_id || null,
        keyId: e.key_id || null,
        signatureValid: Boolean(e.signature_valid),
        status: e.status,
        createdAt: e.created_at,
      })),
      fraudEvents: replaySecurityEvents.map((e) => ({
        id: e.id,
        timestamp: e.created_at,
        eventType: e.event_type,
        severity: e.severity,
        publicUserId: e.public_user_id || null,
        ipPrefix: e.ip_prefix || 'unknown',
        endpoint: e.endpoint || null,
        requestId: e.request_id || null,
        details: safeJsonParse(e.details_json),
        createdAt: e.created_at,
      })),
    };
  }

  /**
   * Computes real DB-derived business, engagement, retention, funnel, and per-tier queue latency analytics.
   */
  public getAnalytics() {
    const db = getDb();
    const nowMs = Date.now();
    const since24h = new Date(nowMs - 86_400_000).toISOString();
    const since7d = new Date(nowMs - 7 * 86_400_000).toISOString();
    const since30d = new Date(nowMs - 30 * 86_400_000).toISOString();

    // 1. DAU & MAU from real sessions, jobs, and analytics_events
    const dauRow = db
      .prepare(
        `SELECT COUNT(DISTINCT uid) AS cnt FROM (
           SELECT user_id AS uid FROM user_sessions WHERE last_seen_at >= ?
           UNION
           SELECT owner_user_id AS uid FROM processing_jobs WHERE created_at >= ?
           UNION
           SELECT user_id AS uid FROM analytics_events WHERE user_id IS NOT NULL AND created_at >= ?
         )`
      )
      .get(since24h, since24h, since24h) as { cnt: number };

    const mauRow = db
      .prepare(
        `SELECT COUNT(DISTINCT uid) AS cnt FROM (
           SELECT user_id AS uid FROM user_sessions WHERE last_seen_at >= ?
           UNION
           SELECT owner_user_id AS uid FROM processing_jobs WHERE created_at >= ?
           UNION
           SELECT user_id AS uid FROM analytics_events WHERE user_id IS NOT NULL AND created_at >= ?
         )`
      )
      .get(since30d, since30d, since30d) as { cnt: number };

    // 2. Registrations
    const regRow = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last24h,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last7d,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last30d,
           SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) AS verified_total,
           SUM(CASE WHEN account_status = 'SUSPENDED' THEN 1 ELSE 0 END) AS suspended_total
         FROM users
         WHERE deleted_at IS NULL`
      )
      .get(since24h, since7d, since30d) as Record<string, number>;

    // 3. Guest-to-registered ratio (30d)
    const guestActorsRow = db
      .prepare(
        `SELECT COUNT(DISTINCT owner_user_id) AS cnt
         FROM processing_jobs
         WHERE upper(owner_tier) = 'GUEST' AND created_at >= ?`
      )
      .get(since30d) as { cnt: number };

    const guestActors30d = Number(guestActorsRow?.cnt ?? 0);
    const registered30d = Number(regRow?.last30d ?? 0);
    const totalActors30d = guestActors30d + registered30d;
    const guestToRegisteredRatePercent =
      totalActors30d > 0 ? Math.round((registered30d / totalActors30d) * 1000) / 10 : 0;

    // 4. Jobs breakdown
    const jobsRow = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last24h,
           SUM(CASE WHEN status IN ('CREATED', 'VALIDATING', 'QUEUED') THEN 1 ELSE 0 END) AS queued,
           SUM(CASE WHEN status IN ('PROCESSING', 'VERIFYING') THEN 1 ELSE 0 END) AS processing,
           SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
         FROM processing_jobs`
      )
      .get(since24h) as Record<string, number>;

    const completedCount = Number(jobsRow?.completed ?? 0);
    const failedCount = Number(jobsRow?.failed ?? 0);
    const terminalCount = completedCount + failedCount;
    const successRatePercent =
      terminalCount > 0 ? Math.round((completedCount / terminalCount) * 1000) / 10 : 100;

    // 5. Batches & Downloads
    const batchRow = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last24h,
           SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed
         FROM batches`
      )
      .get(since24h) as Record<string, number>;

    const artifactRow = db
      .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(size_bytes), 0) AS total_bytes FROM output_artifacts`)
      .get() as { total: number; total_bytes: number };

    const downloadEventsRow = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last24h
         FROM analytics_events
         WHERE event_name IN ('download_started', 'download_completed', 'artifact_downloaded')`
      )
      .get(since24h) as { total: number; last24h: number };

    // 6. Rewarded credits economy
    const rewardEconRow = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN entry_type = 'REWARD_GRANTED' THEN delta ELSE 0 END), 0) AS earned_total,
           COALESCE(SUM(CASE WHEN entry_type = 'REWARD_GRANTED' AND created_at >= ? THEN delta ELSE 0 END), 0) AS earned_24h,
           COALESCE(SUM(CASE WHEN entry_type = 'CREDIT_CONSUMED' THEN ABS(delta) ELSE 0 END), 0) AS consumed_total,
           COALESCE(SUM(CASE WHEN entry_type = 'CREDIT_EXPIRED' THEN ABS(delta) ELSE 0 END), 0) AS expired_total
         FROM credit_ledger`
      )
      .get(since24h) as Record<string, number>;

    const activeExtraRow = db
      .prepare(`SELECT COALESCE(SUM(extra_credits_balance), 0) AS total FROM entitlements`)
      .get() as { total: number };

    // 7. Cohort Retention (Day 1, Day 7, Day 30) — strictly DB-derived
    const computeRetention = (days: number) => {
      const cohortCutoff = new Date(nowMs - days * 86_400_000).toISOString();
      const cohortUsers = db
        .prepare(`SELECT id, created_at FROM users WHERE deleted_at IS NULL AND created_at <= ?`)
        .all(cohortCutoff) as Array<{ id: string; created_at: string }>;

      if (cohortUsers.length === 0) {
        return { cohortSize: 0, retained: 0, ratePercent: 0 };
      }

      let retained = 0;
      const checkStmt = db.prepare(
        `SELECT 1 AS hit FROM (
           SELECT last_seen_at AS ts FROM user_sessions WHERE user_id = ?
           UNION ALL
           SELECT created_at AS ts FROM processing_jobs WHERE owner_user_id = ?
           UNION ALL
           SELECT created_at AS ts FROM analytics_events WHERE user_id = ?
         ) WHERE ts >= ? LIMIT 1`
      );

      for (const u of cohortUsers) {
        const thresholdIso = new Date(
          new Date(u.created_at).getTime() + days * 86_400_000
        ).toISOString();
        const hit = checkStmt.get(u.id, u.id, u.id, thresholdIso);
        if (hit) retained++;
      }

      return {
        cohortSize: cohortUsers.length,
        retained,
        ratePercent: Math.round((retained / cohortUsers.length) * 1000) / 10,
      };
    };

    const day1 = computeRetention(1);
    const day7 = computeRetention(7);
    const day30 = computeRetention(30);

    // 8. Conversion Funnel (last 24h)
    const inspectRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM analytics_events WHERE event_name IN ('media_inspected', 'url_inspected') AND created_at >= ?`
      )
      .get(since24h) as { cnt: number };

    const rewardsVerified24hRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM reward_sessions WHERE status = 'VERIFIED' AND verified_at >= ?`
      )
      .get(since24h) as { cnt: number };

    const jobsCompleted24hRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM processing_jobs WHERE status = 'READY' AND completed_at >= ?`
      )
      .get(since24h) as { cnt: number };

    // 9. Per-tier queue latency (Guest vs Registered/Free vs Premium)
    const latencyRows = db
      .prepare(
        `SELECT upper(owner_tier) AS tier, queue_wait_ms, processing_ms
         FROM processing_jobs
         WHERE queue_wait_ms IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1000`
      )
      .all() as Array<{ tier: string; queue_wait_ms: number; processing_ms: number | null }>;

    const tierGroups: Record<'GUEST' | 'REGISTERED' | 'PREMIUM', { waits: number[]; procs: number[] }> = {
      GUEST: { waits: [], procs: [] },
      REGISTERED: { waits: [], procs: [] },
      PREMIUM: { waits: [], procs: [] },
    };

    for (const r of latencyRows) {
      const bucket: 'GUEST' | 'REGISTERED' | 'PREMIUM' =
        r.tier === 'PREMIUM' || r.tier === 'PRO'
          ? 'PREMIUM'
          : r.tier === 'GUEST'
          ? 'GUEST'
          : 'REGISTERED';
      tierGroups[bucket].waits.push(Number(r.queue_wait_ms));
      if (r.processing_ms !== null && Number.isFinite(Number(r.processing_ms))) {
        tierGroups[bucket].procs.push(Number(r.processing_ms));
      }
    }

    const queueLatencyByTier = Object.fromEntries(
      (['GUEST', 'REGISTERED', 'PREMIUM'] as const).map((tier) => {
        const waits = [...tierGroups[tier].waits].sort((a, b) => a - b);
        const procs = [...tierGroups[tier].procs].sort((a, b) => a - b);
        const avgWaitMs =
          waits.length > 0 ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
        const avgProcessingMs =
          procs.length > 0 ? Math.round(procs.reduce((a, b) => a + b, 0) / procs.length) : 0;
        return [
          tier,
          {
            sampleCount: waits.length,
            avgWaitMs,
            p50WaitMs: computePercentile(waits, 50),
            p95WaitMs: computePercentile(waits, 95),
            avgProcessingMs,
            p50ProcessingMs: computePercentile(procs, 50),
            p95ProcessingMs: computePercentile(procs, 95),
          },
        ];
      })
    );

    const jobsFailed24hRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM processing_jobs WHERE status = 'FAILED' AND updated_at >= ?`
      )
      .get(since24h) as { cnt: number };

    const queueWaitByTier = Object.fromEntries(
      (['GUEST', 'REGISTERED', 'PREMIUM'] as const).map((tier) => {
        const entry = queueLatencyByTier[tier];
        return [
          tier.toLowerCase(),
          {
            p50Ms: entry.p50WaitMs,
            p95Ms: entry.p95WaitMs,
            avgMs: entry.avgWaitMs,
            count: entry.sampleCount,
          },
        ];
      })
    );

    return {
      generatedAt: new Date(nowMs).toISOString(),
      // Top-level AdminAnalyticsSummary contract fields
      dau: Number(dauRow?.cnt ?? 0),
      mau: Number(mauRow?.cnt ?? 0),
      totalUsers: Number(regRow?.total ?? 0),
      registrations24h: Number(regRow?.last24h ?? 0),
      registrations7d: Number(regRow?.last7d ?? 0),
      processingSuccessRate: successRatePercent,
      jobsCompleted24h: Number(jobsCompleted24hRow?.cnt ?? 0),
      jobsFailed24h: Number(jobsFailed24hRow?.cnt ?? 0),
      conversionFunnel: {
        mediaInspections: Number(inspectRow?.cnt ?? 0),
        jobsCreated: Number(jobsRow?.last24h ?? 0),
        jobsCompleted: Number(jobsCompleted24hRow?.cnt ?? 0),
        registrations: Number(regRow?.last24h ?? 0),
        rewardsVerified: Number(rewardsVerified24hRow?.cnt ?? 0),
      },
      queueWaitByTier,
      retentionSummary: {
        day1: day1.ratePercent,
        day7: day7.ratePercent,
        day30: day30.ratePercent,
      },
      // Full structured analytics payload
      users: {
        dau: Number(dauRow?.cnt ?? 0),
        mau: Number(mauRow?.cnt ?? 0),
        totalRegistered: Number(regRow?.total ?? 0),
        verifiedRegistered: Number(regRow?.verified_total ?? 0),
        suspendedUsers: Number(regRow?.suspended_total ?? 0),
        registrations24h: Number(regRow?.last24h ?? 0),
        registrations7d: Number(regRow?.last7d ?? 0),
        registrations30d: registered30d,
        guestActors30d,
        guestToRegisteredRatePercent,
      },
      jobs: {
        total: Number(jobsRow?.total ?? 0),
        last24h: Number(jobsRow?.last24h ?? 0),
        queued: Number(jobsRow?.queued ?? 0),
        processing: Number(jobsRow?.processing ?? 0),
        completed: completedCount,
        failed: failedCount,
        cancelled: Number(jobsRow?.cancelled ?? 0),
        successRatePercent,
      },
      batches: {
        total: Number(batchRow?.total ?? 0),
        last24h: Number(batchRow?.last24h ?? 0),
        completed: Number(batchRow?.completed ?? 0),
      },
      downloads: {
        totalArtifacts: Number(artifactRow?.total ?? 0),
        totalArtifactBytes: Number(artifactRow?.total_bytes ?? 0),
        trackedDownloadsTotal: Number(downloadEventsRow?.total ?? 0),
        trackedDownloads24h: Number(downloadEventsRow?.last24h ?? 0),
      },
      rewards: {
        creditsEarnedTotal: Number(rewardEconRow?.earned_total ?? 0),
        creditsEarned24h: Number(rewardEconRow?.earned_24h ?? 0),
        creditsConsumedTotal: Number(rewardEconRow?.consumed_total ?? 0),
        creditsExpiredTotal: Number(rewardEconRow?.expired_total ?? 0),
        activeExtraCreditsBalance: Number(activeExtraRow?.total ?? 0),
      },
      retention: {
        day1,
        day7,
        day30,
      },
      conversionFunnel24h: {
        mediaInspections: Number(inspectRow?.cnt ?? 0),
        jobsCreated: Number(jobsRow?.last24h ?? 0),
        jobsCompleted: Number(jobsCompleted24hRow?.cnt ?? 0),
        registrations: Number(regRow?.last24h ?? 0),
        rewardsVerified: Number(rewardsVerified24hRow?.cnt ?? 0),
      },
      queueLatencyByTier,
      liveQueue: queueService.getMetrics(),
    };
  }

  /**
   * Lists immutable admin audit trail entries.
   */
  public getAuditLogs(params: { page?: number; limit?: number; action?: string }) {
    const db = getDb();
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params.limit || 50)));
    const offset = (page - 1) * limit;

    const whereClause = params.action?.trim() ? 'WHERE upper(action) = upper(?)' : '';
    const args: Array<string | number> = params.action?.trim() ? [params.action.trim()] : [];

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM admin_audit_logs ${whereClause}`)
      .get(...args) as { total: number };

    const rows = db
      .prepare(
        `SELECT id, admin_user_id, admin_public_id, action, target_type, target_id,
                before_json, after_json, request_id, created_at
         FROM admin_audit_logs
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...args, limit, offset) as Array<Record<string, any>>;

    return {
      page,
      limit,
      total: Number(totalRow?.total ?? 0),
      logs: rows.map((r) => {
        const before = safeJsonParse(r.before_json);
        const after = safeJsonParse(r.after_json);
        return {
          id: r.id,
          timestamp: r.created_at,
          actorUserId: r.admin_user_id,
          actorPublicId: r.admin_public_id || 'SYSTEM',
          adminPublicId: r.admin_public_id || 'SYSTEM',
          action: r.action,
          targetType: r.target_type,
          targetId: r.target_id || null,
          before,
          after,
          details: { before, after },
          requestId: r.request_id || null,
          createdAt: r.created_at,
        };
      }),
    };
  }

  /**
   * Lists redacted structured security events.
   */
  public getSecurityEvents(params: {
    page?: number;
    limit?: number;
    eventType?: string;
    severity?: string;
  }) {
    const db = getDb();
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params.limit || 50)));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const args: Array<string | number> = [];

    if (params.eventType?.trim()) {
      whereClauses.push('upper(event_type) = upper(?)');
      args.push(params.eventType.trim());
    }
    if (params.severity?.trim()) {
      whereClauses.push('upper(severity) = upper(?)');
      args.push(params.severity.trim());
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM security_events ${whereSql}`)
      .get(...args) as { total: number };

    const rows = db
      .prepare(
        `SELECT id, event_type, severity, public_user_id, ip_prefix, endpoint, request_id, details_json, created_at
         FROM security_events
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...args, limit, offset) as Array<Record<string, any>>;

    return {
      page,
      limit,
      total: Number(totalRow?.total ?? 0),
      events: rows.map((e) => ({
        id: e.id,
        timestamp: e.created_at,
        eventType: e.event_type,
        severity: e.severity,
        publicUserId: e.public_user_id || null,
        ipPrefix: e.ip_prefix || 'unknown',
        endpoint: e.endpoint || null,
        requestId: e.request_id || null,
        details: safeJsonParse(e.details_json),
        createdAt: e.created_at,
      })),
    };
  }

  private enrichUserSummary(u: Record<string, any>) {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const since24h = new Date(Date.now() - 86_400_000).toISOString();

    const sessRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM user_sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`
      )
      .get(u.id, nowIso) as { cnt: number };

    const jobRow = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last24h
         FROM processing_jobs WHERE owner_user_id = ?`
      )
      .get(since24h, u.id) as { total: number; last24h: number };

    const entRow = db
      .prepare(`SELECT extra_credits_balance FROM entitlements WHERE user_id = ?`)
      .get(u.id) as { extra_credits_balance: number } | undefined;

    const abuseRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM security_events
         WHERE (user_id = ? OR public_user_id = ?) AND created_at >= ?`
      )
      .get(u.id, u.public_user_id, since24h) as { cnt: number };

    return {
      id: u.public_user_id,
      publicUserId: u.public_user_id,
      email: u.email,
      emailMasked: redactEmail(String(u.email || '')),
      emailVerified: Boolean(u.email_verified),
      displayName: u.display_name || null,
      role: String(u.role || 'USER').toLowerCase(),
      tier: String(u.tier || 'FREE').toLowerCase(),
      status: String(u.account_status || 'ACTIVE'),
      accountStatus: String(u.account_status || 'ACTIVE'),
      mfaEnabled: Boolean(u.mfa_enabled),
      activeSessions: Number(sessRow?.cnt ?? 0),
      jobsTotal: Number(jobRow?.total ?? 0),
      jobsLast24h: Number(jobRow?.last24h ?? 0),
      extraCreditsBalance: Number(entRow?.extra_credits_balance ?? 0),
      abuseFlags: Number(abuseRow?.cnt ?? 0),
      securityFlagsLast24h: Number(abuseRow?.cnt ?? 0),
      usageSummary: {
        extraCreditsRemaining: Number(entRow?.extra_credits_balance ?? 0),
        totalJobs: Number(jobRow?.total ?? 0),
      },
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    };
  }
}

export const adminService = new AdminService();
