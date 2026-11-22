-- =============================================================================
-- MUXARO Media Processing Platform - Relational Database Schema
-- Target Engine: PostgreSQL 16+
-- Extensions: pgcrypto, uuid-ossp
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 1. USERS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    tier VARCHAR(32) NOT NULL DEFAULT 'guest', -- 'guest', 'free_account', 'pro'
    password_hash VARCHAR(255) NULL,
    display_name VARCHAR(128) NULL,
    avatar_url TEXT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- =============================================================================
-- 2. UPLOAD SESSIONS TABLE (Direct-to-R2 Resumable Multipart Uploads)
-- =============================================================================

CREATE TABLE IF NOT EXISTS upload_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    guest_ip_hash VARCHAR(64) NULL,
    storage_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    chunk_size INTEGER NOT NULL DEFAULT 16777216, -- 16MB default (or 32MB for pro/large)
    total_chunks INTEGER NOT NULL DEFAULT 1,
    tool VARCHAR(32) NOT NULL,                    -- 'convert_video', 'extract_audio', 'merge_av', 'batch_playlist'
    target_format VARCHAR(16) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'initiated', -- 'initiated', 'uploading', 'completed', 'aborted', 'expired'
    parts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    retention_tier VARCHAR(16) NOT NULL DEFAULT '60m', -- '60m', '24h'
    magic_bytes_verified BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_user ON upload_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_guest ON upload_sessions(guest_ip_hash, created_at DESC) WHERE guest_ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires_at ON upload_sessions(expires_at);

-- =============================================================================
-- 3. MEDIA JOBS TABLE (Core Execution Pipeline Across Lanes)
-- =============================================================================

CREATE TABLE IF NOT EXISTS media_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    guest_ip_hash VARCHAR(64) NULL,
    guest_session_hash VARCHAR(64) NULL,
    tool VARCHAR(32) NOT NULL,                     -- 'convert_video', 'extract_audio', 'merge_av', 'batch_playlist'
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'
    lane VARCHAR(32) NOT NULL DEFAULT 'fast_io',   -- 'fast_io', 'transcode', 'batch'
    priority INTEGER NOT NULL DEFAULT 10,
    source_url TEXT NULL,
    upload_session_id UUID NULL REFERENCES upload_sessions(id) ON DELETE SET NULL,
    target_format VARCHAR(16) NOT NULL,
    target_resolution VARCHAR(16) NULL,
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_storage_key TEXT NULL,
    output_filename TEXT NULL,
    output_size_bytes BIGINT NULL,
    output_mime_type VARCHAR(128) NULL,
    duration_seconds NUMERIC(10, 3) NULL,
    progress_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    stage VARCHAR(32) NOT NULL DEFAULT 'queued',
    stage_message TEXT NULL,
    error_code VARCHAR(64) NULL,
    error_message TEXT NULL,
    idempotency_key VARCHAR(128) NULL UNIQUE,
    worker_id VARCHAR(128) NULL,
    retention_tier VARCHAR(16) NOT NULL DEFAULT '60m',
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_jobs_status_lane ON media_jobs(status, lane, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_media_jobs_user ON media_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_jobs_guest ON media_jobs(guest_ip_hash, created_at DESC) WHERE guest_ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_jobs_expires_at ON media_jobs(expires_at) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_media_jobs_worker ON media_jobs(worker_id, status) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_media_jobs_idempotency ON media_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- =============================================================================
-- 4. DAILY USAGE LEDGER (Sliding / Daily Window Quotas & Bandwidth Tracking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS daily_usage_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_key VARCHAR(128) NOT NULL,             -- 'user:UUID' or 'guest:IP_HASH'
    user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    tier VARCHAR(32) NOT NULL DEFAULT 'guest',
    jobs_count INTEGER NOT NULL DEFAULT 0,
    bandwidth_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_daily_usage_subject_date UNIQUE (subject_key, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage_ledger(usage_date);
CREATE INDEX IF NOT EXISTS idx_daily_usage_user ON daily_usage_ledger(user_id, usage_date);

-- =============================================================================
-- 5. SERVICE INCIDENTS (Circuit Breakers & Platform Health Auditing)
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(64) NOT NULL,             -- 'api', 'worker-analyse', 'worker-media', 'redis', 'postgres', 'r2'
    incident_type VARCHAR(64) NOT NULL,            -- 'CIRCUIT_BREAKER_TRIPPED', 'RATE_LIMIT_SPIKE', 'PROXY_EXHAUSTION', etc.
    severity VARCHAR(32) NOT NULL DEFAULT 'medium',-- 'low', 'medium', 'high', 'critical'
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_incidents_active ON service_incidents(service_name, created_at DESC) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_service_incidents_severity ON service_incidents(severity, created_at DESC);

-- =============================================================================
-- AUTOMATIC TIMESTAMP TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_upload_sessions_updated_at ON upload_sessions;
CREATE TRIGGER trg_upload_sessions_updated_at BEFORE UPDATE ON upload_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_media_jobs_updated_at ON media_jobs;
CREATE TRIGGER trg_media_jobs_updated_at BEFORE UPDATE ON media_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_daily_usage_ledger_updated_at ON daily_usage_ledger;
CREATE TRIGGER trg_daily_usage_ledger_updated_at BEFORE UPDATE ON daily_usage_ledger FOR EACH ROW EXECUTE FUNCTION set_updated_at();
