/**
 * Project MUXARO - Persistent Relational SQLite Database Store (Node 24 node:sqlite)
 *
 * Mirrors infra/migrations/002_account_rewards_analytics.sql with ALL 22 relational tables,
 * WAL journal mode, strict foreign keys, seeded system_settings, and atomic transaction helper.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_DB_DIR = path.resolve(process.cwd(), '.muxaro-data');
export const DEFAULT_DB_PATH = process.env.MUXARO_DB_PATH || path.join(DEFAULT_DB_DIR, 'muxaro.db');

export const DEFAULT_SYSTEM_SETTINGS: ReadonlyArray<{
  key: string;
  value: string;
  description: string;
}> = [
  { key: 'base_individual_limit', value: '10', description: 'Free registered user individual jobs per rolling 24h' },
  { key: 'guest_individual_limit', value: '100', description: 'Guest individual jobs per rolling 24h' },
  { key: 'premium_individual_limit', value: '100', description: 'Premium user individual jobs per rolling 24h' },
  { key: 'base_playlist_limit', value: '1', description: 'Free registered user playlist jobs per rolling 24h' },
  { key: 'guest_playlist_limit', value: '0', description: 'Guest playlist jobs per rolling 24h' },
  { key: 'premium_playlist_limit', value: '10', description: 'Premium user playlist jobs per rolling 24h' },
  { key: 'reward_credits_per_ad', value: '2', description: 'Extra individual job credits granted per verified rewarded ad' },
  { key: 'reward_daily_cap', value: '3', description: 'Maximum verified rewarded ads per user per rolling 24h' },
  { key: 'reward_expiry_hours', value: '24', description: 'Rolling expiration window in hours for earned reward credits' },
  { key: 'guest_max_concurrent', value: '1', description: 'Max concurrent active jobs for guest tier' },
  { key: 'free_max_concurrent', value: '2', description: 'Max concurrent active jobs for free registered tier' },
  { key: 'premium_max_concurrent', value: '5', description: 'Max concurrent active jobs for premium tier' },
  { key: 'max_upload_size_mb', value: '2048', description: 'Maximum local file upload size in MB' },
  { key: 'max_playlist_items', value: '50', description: 'Maximum items allowed in a playlist batch job' },
  { key: 'rewarded_ads_enabled', value: 'true', description: 'Global feature flag enabling rewarded ads when GAM is configured' },
  { key: 'artifact_retention_minutes', value: '60', description: 'Completed artifact retention duration in minutes' },
];

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- 1. Users (internal UUIDv7 + customer-safe MXR-XXXXXXXX public ID)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  public_user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'USER',
  tier TEXT NOT NULL DEFAULT 'FREE',
  account_status TEXT NOT NULL DEFAULT 'ACTIVE',
  preferences_json TEXT NOT NULL DEFAULT '{}',
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_public_id ON users(public_user_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(account_status);

-- 2. OAuth Accounts (Google OpenID Connect)
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

-- 3. OAuth PKCE States (server-side state + nonce + code_verifier)
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  ip_prefix TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

-- 4. User Sessions (HttpOnly cookie session store, SHA-256 hashed tokens)
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  mfa_verified INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT,
  ip_prefix TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);

-- 5. Email Verifications (single-use hashed verification tokens/codes)
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);

-- 6. Password Resets (single-use hashed reset tokens)
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- 7. User MFA (RFC 6238 TOTP for admin accounts)
CREATE TABLE IF NOT EXISTS user_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  backup_codes_json TEXT NOT NULL DEFAULT '[]',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 8. Entitlements (per-account allowance snapshots)
CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'FREE',
  base_individual_limit INTEGER NOT NULL DEFAULT 10,
  base_playlist_limit INTEGER NOT NULL DEFAULT 1,
  max_concurrent_jobs INTEGER NOT NULL DEFAULT 2,
  extra_credits_balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- 9. Quota Reservations (atomic rolling 24h reservations)
CREATE TABLE IF NOT EXISTS quota_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'base',
  status TEXT NOT NULL DEFAULT 'RESERVED',
  idempotency_key TEXT UNIQUE,
  reference_id TEXT,
  reason TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quota_res_user_bucket ON quota_reservations(user_id, bucket, status, created_at);

-- 10. Credit Ledger (strictly immutable audit trail)
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  delta INTEGER NOT NULL,
  remaining_delta INTEGER NOT NULL DEFAULT 0,
  balance_after INTEGER NOT NULL DEFAULT 0,
  reference_id TEXT,
  reason TEXT,
  expires_at TEXT,
  expired_processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_expiry ON credit_ledger(entry_type, expired_processed, expires_at);

-- 11. Reward Sessions (Google Ad Manager rewarded ad claims)
CREATE TABLE IF NOT EXISTS reward_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'gam',
  ad_unit_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reward_amount INTEGER NOT NULL DEFAULT 2,
  custom_data_hash TEXT NOT NULL,
  provider_transaction_id TEXT,
  ip_prefix TEXT,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reward_sessions_user ON reward_sessions(user_id, status, created_at DESC);

-- 12. Reward Provider Events (replay protection via UNIQUE provider_transaction_id)
CREATE TABLE IF NOT EXISTS reward_provider_events (
  id TEXT PRIMARY KEY,
  provider_transaction_id TEXT NOT NULL UNIQUE,
  reward_session_id TEXT,
  user_id TEXT,
  key_id TEXT,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  raw_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reward_events_session ON reward_provider_events(reward_session_id);

-- 13. Media Assets
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT,
  local_file_path TEXT,
  title TEXT,
  author TEXT,
  container TEXT,
  duration_seconds REAL,
  file_size_bytes INTEGER,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_assets_owner ON media_assets(owner_user_id);

-- 14. Batches (MXB-YYYYMMDD-XXXXXX)
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  owner_tier TEXT NOT NULL DEFAULT 'FREE',
  title TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED',
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  cancelled_items INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  zip_download_url TEXT,
  zip_file_path TEXT,
  zip_filename TEXT,
  zip_size_bytes INTEGER,
  retention_minutes INTEGER NOT NULL DEFAULT 60,
  idempotency_key TEXT UNIQUE,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_batches_owner ON batches(owner_user_id, created_at DESC);

-- 15. Processing Jobs (MXJ-XXXXXXXXXX)
CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  owner_tier TEXT NOT NULL DEFAULT 'GUEST',
  batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL,
  item_number TEXT,
  media_asset_id TEXT,
  media_url TEXT,
  local_file_path TEXT,
  audio_url TEXT,
  audio_offset_ms INTEGER DEFAULT 0,
  input_title TEXT,
  operation TEXT NOT NULL,
  target_format TEXT NOT NULL,
  target_resolution TEXT,
  target_audio_codec TEXT,
  stream_copy INTEGER NOT NULL DEFAULT 0,
  format_id TEXT,
  processing_lane TEXT NOT NULL DEFAULT 'smart',
  queue_class TEXT NOT NULL DEFAULT 'video-transcoding',
  strategy_label TEXT,
  lossless_preserved INTEGER NOT NULL DEFAULT 0,
  retention_minutes INTEGER NOT NULL DEFAULT 60,
  priority_weight INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  progress INTEGER NOT NULL DEFAULT 0,
  stage TEXT,
  stage_message TEXT,
  idempotency_key TEXT,
  reservation_id TEXT,
  request_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  queued_at TEXT,
  started_at TEXT,
  queue_wait_ms INTEGER,
  processing_ms INTEGER,
  download_url TEXT,
  error_code TEXT,
  error_message TEXT,
  user_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_owner ON processing_jobs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_batch ON processing_jobs(batch_id, item_number);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status, queue_class);
CREATE INDEX IF NOT EXISTS idx_jobs_request_id ON processing_jobs(request_id);

-- 16. Job Events
CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  stage TEXT,
  message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, created_at);

-- 17. Output Artifacts
CREATE TABLE IF NOT EXISTS output_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  container TEXT NOT NULL,
  codec TEXT,
  duration_seconds REAL,
  checksum_sha256 TEXT,
  download_url TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_job ON output_artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON output_artifacts(owner_user_id);

-- 18. Rate Limit Counters
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  window_start_ms INTEGER NOT NULL,
  window_ms INTEGER NOT NULL,
  blocked_until_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- 19. Security Events
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO',
  user_id TEXT,
  public_user_id TEXT,
  ip_prefix TEXT,
  endpoint TEXT,
  request_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id, created_at DESC);

-- 20. Admin Audit Logs (immutable)
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  admin_public_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);

-- 21. System Settings (admin-configurable platform controls)
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- 22. Analytics Events (server-side KPI metrics for Admin Control Centre)
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_id TEXT,
  tier TEXT,
  properties_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_name_created ON analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_user_created ON analytics_events(user_id, created_at DESC);

-- 23. AI Research Jobs (async background Deep Research persistence)
CREATE TABLE IF NOT EXISTS ai_research_jobs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  sources_json TEXT NOT NULL DEFAULT '[]',
  report_md TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_research_status ON ai_research_jobs(status, created_at DESC);
`;

let dbInstance: DatabaseSync | null = null;

function seedSystemSettings(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO system_settings (key, value, description, updated_by, updated_at)
     VALUES (?, ?, ?, 'system', ?)`
  );
  for (const item of DEFAULT_SYSTEM_SETTINGS) {
    stmt.run(item.key, item.value, item.description, now);
  }
}

/**
 * Returns the singleton persistent SQLite DatabaseSync connection.
 * Automatically creates `.muxaro-data/muxaro.db`, enables WAL + foreign keys,
 * applies all 22 tables, and seeds default system_settings.
 */
export function getDb(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const targetPath = customPath || DEFAULT_DB_PATH;
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec(SCHEMA_SQL);
  seedSystemSettings(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

/**
 * Runs a synchronous callback inside an atomic SQLite IMMEDIATE transaction.
 */
export function runInTransaction<T>(fn: (db: DatabaseSync) => T, db: DatabaseSync = getDb()): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error if transaction already closed
    }
    throw err;
  }
}

/**
 * Reads a numeric setting from `system_settings` with safe fallback.
 */
export function getNumericSetting(key: string, fallback: number, db: DatabaseSync = getDb()): number {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value?: string }
    | undefined;
  if (!row?.value) return fallback;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reads a boolean setting from `system_settings` with safe fallback.
 */
export function getBooleanSetting(key: string, fallback: boolean, db: DatabaseSync = getDb()): boolean {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value?: string }
    | undefined;
  if (!row?.value) return fallback;
  return row.value.toLowerCase() === 'true' || row.value === '1';
}

/**
 * Records a server-side analytics event without PII (used for Admin KPI aggregations).
 */
export function recordAnalyticsEvent(
  eventName: string,
  userId?: string | null,
  tier?: string | null,
  properties: Record<string, unknown> = {}
): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO analytics_events (id, event_name, user_id, tier, properties_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      eventName,
      userId ?? null,
      tier ?? null,
      JSON.stringify(properties),
      new Date().toISOString()
    );
  } catch {
    // Non-blocking telemetry
  }
}

/**
 * Closes the singleton DB cleanly (for graceful shutdown or tests).
 */
export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
  }
}
