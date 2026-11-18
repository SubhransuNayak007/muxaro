-- ==============================================================================
-- Project MUXARO - Migration 002: Account Platform, Rewarded Ads SSV,
-- Batches, 3-Tier Priority Processing, Security & Analytics (22 Tables)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Users (internal UUIDv7 + customer-safe MXR-XXXXXXXX public ID)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  public_user_id VARCHAR(32) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT,
  display_name VARCHAR(120),
  avatar_url TEXT,
  role VARCHAR(20) NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'PRO', 'ADMIN')),
  tier VARCHAR(20) NOT NULL DEFAULT 'FREE' CHECK (tier IN ('GUEST', 'FREE', 'PRO', 'PREMIUM', 'ADMIN')),
  account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS public_user_id VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'USER';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'FREE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_public_user_id ON users(public_user_id) WHERE public_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status);

-- ------------------------------------------------------------------------------
-- 2. OAuth Accounts (Google OpenID Connect)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_oauth_provider_subject UNIQUE (provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);

-- ------------------------------------------------------------------------------
-- 3. OAuth PKCE States (server-side state + nonce + code_verifier)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  ip_prefix VARCHAR(64),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);

-- ------------------------------------------------------------------------------
-- 4. User Sessions (HttpOnly session store, SHA-256 hashed tokens)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
  user_agent TEXT,
  ip_prefix VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- ------------------------------------------------------------------------------
-- 5. Email Verifications (single-use hashed verification tokens/codes)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);

-- ------------------------------------------------------------------------------
-- 6. Password Resets (single-use hashed reset tokens)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

-- ------------------------------------------------------------------------------
-- 7. User MFA (RFC 6238 TOTP for Admin Accounts)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  backup_codes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 8. Entitlements (per-account quota snapshots)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT PRIMARY KEY,
  tier VARCHAR(20) NOT NULL DEFAULT 'FREE',
  base_individual_limit INTEGER NOT NULL DEFAULT 10,
  base_playlist_limit INTEGER NOT NULL DEFAULT 1,
  max_concurrent_jobs INTEGER NOT NULL DEFAULT 2,
  extra_credits_balance INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 9. Quota Reservations (atomic rolling 24h reservations)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quota_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bucket VARCHAR(32) NOT NULL CHECK (bucket IN ('individual', 'playlist')),
  units INTEGER NOT NULL DEFAULT 1 CHECK (units > 0),
  source VARCHAR(20) NOT NULL DEFAULT 'base' CHECK (source IN ('base', 'reward')),
  status VARCHAR(20) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  idempotency_key VARCHAR(128) UNIQUE,
  reference_id TEXT,
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quota_reservations_lookup ON quota_reservations(user_id, bucket, status, created_at);

-- ------------------------------------------------------------------------------
-- 10. Credit Ledger (strictly immutable audit trail)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entry_type VARCHAR(32) NOT NULL CHECK (
    entry_type IN (
      'REWARD_GRANTED',
      'CREDIT_RESERVED',
      'CREDIT_CONSUMED',
      'CREDIT_RELEASED',
      'ADMIN_ADJUSTMENT',
      'CREDIT_EXPIRED'
    )
  ),
  delta INTEGER NOT NULL,
  remaining_delta INTEGER NOT NULL DEFAULT 0,
  balance_after INTEGER NOT NULL DEFAULT 0,
  reference_id TEXT,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  expired_processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created ON credit_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_expiry ON credit_ledger(entry_type, expired_processed, expires_at);

-- ------------------------------------------------------------------------------
-- 11. Reward Sessions (Google Ad Manager rewarded ad claims)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reward_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'gam',
  ad_unit_path TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'REJECTED')),
  reward_amount INTEGER NOT NULL DEFAULT 2 CHECK (reward_amount > 0),
  custom_data_hash TEXT NOT NULL,
  provider_transaction_id TEXT,
  ip_prefix VARCHAR(64),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reward_sessions_user_status ON reward_sessions(user_id, status, created_at DESC);

-- ------------------------------------------------------------------------------
-- 12. Reward Provider Events (SSV replay protection via UNIQUE transaction ID)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reward_provider_events (
  id TEXT PRIMARY KEY,
  provider_transaction_id TEXT NOT NULL UNIQUE,
  reward_session_id TEXT,
  user_id TEXT,
  key_id VARCHAR(64),
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('ACCEPTED', 'DUPLICATE', 'REJECTED')),
  raw_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reward_provider_events_session ON reward_provider_events(reward_session_id);

-- ------------------------------------------------------------------------------
-- 13. Media Assets
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  source_type VARCHAR(50) NOT NULL,
  source_url TEXT,
  local_file_path TEXT,
  title TEXT,
  author TEXT,
  container VARCHAR(30),
  duration_seconds NUMERIC(10, 2),
  file_size_bytes BIGINT,
  manifest_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_assets_owner_user ON media_assets(owner_user_id);

-- ------------------------------------------------------------------------------
-- 14. Batches (MXB-YYYYMMDD-XXXXXX)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  owner_tier VARCHAR(20) NOT NULL DEFAULT 'FREE',
  title TEXT NOT NULL,
  source_url TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'CREATED',
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  cancelled_items INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  zip_download_url TEXT,
  zip_file_path TEXT,
  zip_filename VARCHAR(255),
  zip_size_bytes BIGINT,
  retention_minutes INTEGER NOT NULL DEFAULT 60,
  idempotency_key VARCHAR(128) UNIQUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_batches_owner_created ON batches(owner_user_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 15. Processing Jobs (MXJ-XXXXXXXXXX with batch + priority tier tracking)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  owner_tier VARCHAR(20) NOT NULL DEFAULT 'GUEST',
  batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL,
  item_number VARCHAR(8),
  media_asset_id TEXT,
  media_url TEXT,
  local_file_path TEXT,
  audio_url TEXT,
  audio_offset_ms INTEGER DEFAULT 0,
  input_title TEXT,
  operation VARCHAR(50) NOT NULL,
  target_format VARCHAR(32) NOT NULL,
  target_resolution VARCHAR(32),
  target_audio_codec VARCHAR(32),
  stream_copy BOOLEAN NOT NULL DEFAULT FALSE,
  format_id VARCHAR(64),
  processing_lane VARCHAR(20) NOT NULL DEFAULT 'smart',
  queue_class VARCHAR(40) NOT NULL DEFAULT 'video-transcoding',
  strategy_label VARCHAR(120),
  lossless_preserved BOOLEAN NOT NULL DEFAULT FALSE,
  retention_minutes INTEGER NOT NULL DEFAULT 60,
  priority_weight INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
  progress INTEGER NOT NULL DEFAULT 0,
  stage VARCHAR(40),
  stage_message TEXT,
  idempotency_key VARCHAR(128),
  reservation_id TEXT,
  request_id VARCHAR(64),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  queued_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  queue_wait_ms INTEGER,
  processing_ms INTEGER,
  download_url TEXT,
  error_code VARCHAR(100),
  error_message TEXT,
  user_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_owner_created ON processing_jobs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_batch_item ON processing_jobs(batch_id, item_number);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_queue ON processing_jobs(status, queue_class);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_request_id ON processing_jobs(request_id);

-- ------------------------------------------------------------------------------
-- 16. Job Events
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  stage VARCHAR(40),
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_events_job_created ON job_events(job_id, created_at);

-- ------------------------------------------------------------------------------
-- 17. Output Artifacts
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS output_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  container VARCHAR(32) NOT NULL,
  codec VARCHAR(64),
  duration_seconds NUMERIC(10, 2),
  checksum_sha256 VARCHAR(128),
  download_url TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_output_artifacts_job ON output_artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_output_artifacts_owner ON output_artifacts(owner_user_id);

-- ------------------------------------------------------------------------------
-- 18. Rate Limit Counters
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  window_start_ms BIGINT NOT NULL,
  window_ms BIGINT NOT NULL,
  blocked_until_ms BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 19. Security Events
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
  user_id TEXT,
  public_user_id VARCHAR(32),
  ip_prefix VARCHAR(64),
  endpoint VARCHAR(255),
  request_id VARCHAR(64),
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_security_events_type_created ON security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_user_created ON security_events(user_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 20. Admin Audit Logs (immutable)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  admin_public_id VARCHAR(32),
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id TEXT,
  before_json JSONB,
  after_json JSONB,
  request_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC);

-- ------------------------------------------------------------------------------
-- 21. System Settings (admin-configurable platform policies)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(80) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value, description, updated_by) VALUES
  ('base_individual_limit', '10', 'Free registered user individual jobs per rolling 24h', 'system'),
  ('guest_individual_limit', '3', 'Guest individual jobs per rolling 24h', 'system'),
  ('premium_individual_limit', '100', 'Premium user individual jobs per rolling 24h', 'system'),
  ('base_playlist_limit', '1', 'Free registered user playlist jobs per rolling 24h', 'system'),
  ('guest_playlist_limit', '0', 'Guest playlist jobs per rolling 24h', 'system'),
  ('premium_playlist_limit', '10', 'Premium user playlist jobs per rolling 24h', 'system'),
  ('reward_credits_per_ad', '2', 'Extra individual job credits granted per verified rewarded ad', 'system'),
  ('reward_daily_cap', '3', 'Maximum verified rewarded ads per user per rolling 24h', 'system'),
  ('reward_expiry_hours', '24', 'Rolling expiration window in hours for earned reward credits', 'system'),
  ('guest_max_concurrent', '1', 'Max concurrent active jobs for guest tier', 'system'),
  ('free_max_concurrent', '2', 'Max concurrent active jobs for free registered tier', 'system'),
  ('premium_max_concurrent', '5', 'Max concurrent active jobs for premium tier', 'system'),
  ('max_upload_size_mb', '2048', 'Maximum local file upload size in MB', 'system'),
  ('max_playlist_items', '50', 'Maximum items allowed in a playlist batch job', 'system'),
  ('rewarded_ads_enabled', 'true', 'Global feature flag enabling rewarded ads when GAM is configured', 'system'),
  ('artifact_retention_minutes', '60', 'Completed artifact retention duration in minutes', 'system')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 22. Analytics Events (server-side KPI telemetry for Admin Control Centre)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_name VARCHAR(80) NOT NULL,
  user_id TEXT,
  tier VARCHAR(20),
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created ON analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created ON analytics_events(user_id, created_at DESC);

COMMIT;
