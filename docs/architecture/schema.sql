-- =============================================================================
-- MUXARO Media Processing Platform Relational Database Schema
-- Formerly Project VYRO
-- Target Engine: PostgreSQL 16+
-- Schema Version: 1.0.0
-- Standard: ANSI SQL / PostgreSQL Strict Typings & Constraints
-- =============================================================================

-- Enable required core extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

CREATE TYPE account_status_enum AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'BANNED',
    'PENDING_VERIFICATION'
);

CREATE TYPE user_role_enum AS ENUM (
    'GUEST',
    'FREE_USER',
    'PRO_USER',
    'OPERATOR',
    'ADMIN'
);

CREATE TYPE source_type_enum AS ENUM (
    'DIRECT_URL',
    'USER_UPLOAD',
    'YOUTUBE_PERMITTED_OEMBED',
    'SYNTHETIC_TEST'
);

CREATE TYPE inspection_status_enum AS ENUM (
    'PENDING',
    'INSPECTED',
    'FAILED',
    'EXPIRED'
);

CREATE TYPE stream_type_enum AS ENUM (
    'VIDEO',
    'AUDIO',
    'SUBTITLE',
    'DATA'
);

CREATE TYPE job_type_enum AS ENUM (
    'SINGLE_MEDIA',
    'AUDIO_EXTRACTION',
    'VIDEO_MERGE',
    'MEDIA_CONVERSION',
    'PLAYLIST_CHILD'
);

CREATE TYPE job_status_enum AS ENUM (
    'CREATED',
    'VALIDATING',
    'QUEUED',
    'PROCESSING',
    'VERIFYING',
    'READY',
    'RETRY_WAIT',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'FAILED',
    'REJECTED',
    'EXPIRED'
);

CREATE TYPE playlist_status_enum AS ENUM (
    'CREATED',
    'INSPECTING',
    'QUEUED',
    'PROCESSING',
    'PACKAGING',
    'COMPLETED',
    'PARTIAL_FAILURE',
    'FAILED',
    'CANCELLED'
);

CREATE TYPE entitlement_type_enum AS ENUM (
    'INDIVIDUAL_VIDEO_JOB',
    'PLAYLIST_JOB',
    'BANDWIDTH_BYTES',
    'CONCURRENT_JOBS'
);

CREATE TYPE reservation_status_enum AS ENUM (
    'RESERVED',
    'CONSUMED',
    'RELEASED',
    'EXPIRED'
);

CREATE TYPE ledger_transaction_type_enum AS ENUM (
    'GRANT',
    'RESERVATION',
    'CONSUMPTION',
    'REFUND',
    'EXPIRATION',
    'ADJUSTMENT'
);

-- =============================================================================
-- 1. USERS & SESSIONS
-- =============================================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_provider VARCHAR(64) NOT NULL DEFAULT 'local', -- 'local', 'google', 'github', 'guest'
    provider_subject VARCHAR(255) NOT NULL,                 -- Unique identifier from IdP or guest session
    email VARCHAR(255) NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    display_name VARCHAR(128) NULL,
    account_status account_status_enum NOT NULL DEFAULT 'ACTIVE',
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_provider_subject UNIQUE (identity_provider, provider_subject)
);

CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_status ON users(account_status);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role user_role_enum NOT NULL DEFAULT 'FREE_USER',
    assigned_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role)
);

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);

-- Guest sessions for tracking unauthenticated users by fingerprint & cookie
CREATE TABLE guest_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token VARCHAR(128) NOT NULL UNIQUE,
    ip_hash VARCHAR(64) NOT NULL,
    user_agent_hash VARCHAR(64) NOT NULL,
    linked_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_guest_sessions_token ON guest_sessions(session_token);
CREATE INDEX idx_guest_sessions_ip_hash ON guest_sessions(ip_hash, created_at);

-- =============================================================================
-- 2. MEDIA ASSETS & STREAMS (INSPECTION CACHE)
-- =============================================================================

CREATE TABLE media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    guest_session_id UUID NULL REFERENCES guest_sessions(id) ON DELETE SET NULL,
    source_type source_type_enum NOT NULL,
    source_reference TEXT NOT NULL,                         -- Sanitized URL or storage path
    canonical_url_hash VARCHAR(64) NOT NULL,               -- SHA-256 for fast deduplicated inspection
    storage_key VARCHAR(512) NULL,                         -- S3 key if uploaded directly
    original_filename VARCHAR(255) NULL,
    title VARCHAR(512) NULL,
    thumbnail_url TEXT NULL,
    container VARCHAR(32) NULL,                            -- 'mp4', 'webm', 'mkv', 'mp3', etc.
    duration_seconds NUMERIC(10, 3) NULL,
    file_size_bytes BIGINT NULL,
    video_codec VARCHAR(32) NULL,
    audio_codec VARCHAR(32) NULL,
    width INTEGER NULL,
    height INTEGER NULL,
    frame_rate NUMERIC(6, 2) NULL,
    inspection_status inspection_status_enum NOT NULL DEFAULT 'PENDING',
    raw_probe_json JSONB NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_media_assets_url_hash ON media_assets(canonical_url_hash, inspection_status);
CREATE INDEX idx_media_assets_expires_at ON media_assets(expires_at);

CREATE TABLE media_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    stream_index INTEGER NOT NULL,
    stream_type stream_type_enum NOT NULL,
    codec VARCHAR(32) NOT NULL,
    bitrate BIGINT NULL,
    width INTEGER NULL,                                     -- For video
    height INTEGER NULL,                                    -- For video
    fps NUMERIC(6, 2) NULL,                                 -- For video
    sample_rate INTEGER NULL,                               -- For audio (e.g. 44100, 48000)
    channels INTEGER NULL,                                  -- For audio (e.g. 2 for stereo)
    channel_layout VARCHAR(32) NULL,                       -- 'stereo', '5.1'
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_media_stream_index UNIQUE (media_asset_id, stream_index)
);

CREATE INDEX idx_media_streams_asset ON media_streams(media_asset_id, stream_type);

-- =============================================================================
-- 3. PROCESSING JOBS & ARTIFACTS
-- =============================================================================

CREATE TABLE processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    guest_session_id UUID NULL REFERENCES guest_sessions(id) ON DELETE SET NULL,
    media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    job_type job_type_enum NOT NULL DEFAULT 'SINGLE_MEDIA',
    status job_status_enum NOT NULL DEFAULT 'CREATED',
    priority INTEGER NOT NULL DEFAULT 10,                   -- Higher number = higher priority
    operation VARCHAR(64) NOT NULL,                         -- 'EXTRACT_AUDIO', 'REMUX_STREAM_COPY', 'TRANSCODE_VIDEO', 'MERGE_AV'
    target_format VARCHAR(16) NOT NULL,                     -- 'mp4', 'webm', 'mp3', 'm4a', 'flac', 'wav'
    target_resolution VARCHAR(16) NULL,                    -- 'source', '4320p', '2160p', '1080p', '720p', etc.
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key VARCHAR(128) NOT NULL,
    worker_id VARCHAR(128) NULL,                            -- ID of worker currently holding execution
    progress_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    progress_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error_code VARCHAR(64) NULL,
    error_message TEXT NULL,
    error_details JSONB NULL,
    queued_at TIMESTAMPTZ NULL,
    started_at TIMESTAMPTZ NULL,
    verified_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_processing_jobs_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX idx_jobs_status_priority ON processing_jobs(status, priority DESC, queued_at ASC);
CREATE INDEX idx_jobs_owner_user ON processing_jobs(owner_user_id, created_at DESC);
CREATE INDEX idx_jobs_guest_session ON processing_jobs(guest_session_id, created_at DESC) WHERE guest_session_id IS NOT NULL;
CREATE INDEX idx_jobs_worker_heartbeat ON processing_jobs(worker_id, status) WHERE status = 'PROCESSING';

CREATE TABLE output_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processing_job_id UUID NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
    storage_key VARCHAR(512) NOT NULL UNIQUE,              -- S3 object path: artifacts/{jobId}/{filename}
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    container VARCHAR(32) NOT NULL,
    video_codec VARCHAR(32) NULL,
    audio_codec VARCHAR(32) NULL,
    duration_seconds NUMERIC(10, 3) NOT NULL,
    download_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_output_artifacts_job ON output_artifacts(processing_job_id);
CREATE INDEX idx_output_artifacts_expires ON output_artifacts(expires_at);

-- =============================================================================
-- 4. PLAYLIST & BATCH ORCHESTRATION
-- =============================================================================

CREATE TABLE playlist_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    guest_session_id UUID NULL REFERENCES guest_sessions(id) ON DELETE SET NULL,
    title VARCHAR(512) NOT NULL,
    source_reference TEXT NOT NULL,
    status playlist_status_enum NOT NULL DEFAULT 'CREATED',
    total_items INTEGER NOT NULL DEFAULT 0,
    completed_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    cancelled_items INTEGER NOT NULL DEFAULT 0,
    zip_artifact_id UUID NULL REFERENCES output_artifacts(id) ON DELETE SET NULL,
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_playlist_jobs_owner ON playlist_jobs(owner_user_id, created_at DESC);

CREATE TABLE playlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_job_id UUID NOT NULL REFERENCES playlist_jobs(id) ON DELETE CASCADE,
    media_asset_id UUID NULL REFERENCES media_assets(id) ON DELETE SET NULL,
    processing_job_id UUID NULL REFERENCES processing_jobs(id) ON DELETE SET NULL,
    position INTEGER NOT NULL,
    title VARCHAR(512) NULL,
    source_url TEXT NOT NULL,
    status job_status_enum NOT NULL DEFAULT 'CREATED',
    error_code VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_playlist_position UNIQUE (playlist_job_id, position)
);

CREATE INDEX idx_playlist_items_job ON playlist_items(playlist_job_id, position);

-- =============================================================================
-- 5. ENTITLEMENTS, QUOTA RESERVATION & CREDIT LEDGER
-- =============================================================================

-- Dynamic user entitlement definitions (Default: 10 individual jobs, 1 playlist job per 24h)
CREATE TABLE entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    role user_role_enum NOT NULL DEFAULT 'FREE_USER',
    entitlement_type entitlement_type_enum NOT NULL,
    allowance INTEGER NOT NULL,                              -- 10 for individual, 1 for playlist
    window_seconds INTEGER NOT NULL DEFAULT 86400,          -- 86400 = 24 hours rolling
    effective_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    effective_until TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_entitlement UNIQUE (user_id, entitlement_type, effective_from)
);

CREATE INDEX idx_entitlements_user_type ON entitlements(user_id, entitlement_type);

-- Atomic Quota Reservations during Job Admission
CREATE TABLE quota_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_session_id UUID NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
    entitlement_type entitlement_type_enum NOT NULL,
    job_id UUID NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
    playlist_job_id UUID NULL REFERENCES playlist_jobs(id) ON DELETE CASCADE,
    units_reserved INTEGER NOT NULL DEFAULT 1,
    status reservation_status_enum NOT NULL DEFAULT 'RESERVED',
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at TIMESTAMPTZ NULL,
    released_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour'),
    CONSTRAINT uq_job_reservation UNIQUE (job_id, entitlement_type)
);

-- Crucial Composite Index for Rolling 24-Hour Active Quota Calculation
CREATE INDEX idx_quota_rolling_window ON quota_reservations (
    user_id, 
    entitlement_type, 
    status, 
    reserved_at
);

CREATE INDEX idx_guest_quota_rolling_window ON quota_reservations (
    guest_session_id, 
    entitlement_type, 
    status, 
    reserved_at
) WHERE guest_session_id IS NOT NULL;

-- Append-Only Credit Transaction Ledger
CREATE TABLE credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_type ledger_transaction_type_enum NOT NULL,
    amount INTEGER NOT NULL,                                -- Positive for credits added, negative for deducted
    balance_after INTEGER NOT NULL,
    reference_type VARCHAR(32) NOT NULL,                   -- 'JOB', 'PLAYLIST', 'PURCHASE', 'PROMO'
    reference_id UUID NULL,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);

-- =============================================================================
-- 6. TRANSACTIONAL OUTBOX & AUDIT LOGS
-- =============================================================================

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,                   -- 'JOB', 'PLAYLIST', 'USER'
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(64) NOT NULL,                       -- 'JOB_ENQUEUED', 'JOB_CANCELLED', 'ARTIFACT_VERIFIED'
    payload_json JSONB NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    published_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_outbox_unpublished ON outbox_events(created_at ASC) WHERE published_at IS NULL;

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    guest_session_id UUID NULL REFERENCES guest_sessions(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,                            -- 'JOB_SUBMIT', 'JOB_CANCEL', 'INSPECT_URL', 'AUTH_LOGIN'
    resource_type VARCHAR(64) NOT NULL,
    resource_id UUID NULL,
    request_id VARCHAR(64) NOT NULL,
    ip_address INET NULL,
    user_agent TEXT NULL,
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_request ON audit_logs(request_id);

-- =============================================================================
-- AUTOMATIC TIMESTAMP TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_media_assets_updated_at BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_processing_jobs_updated_at BEFORE UPDATE ON processing_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_playlist_jobs_updated_at BEFORE UPDATE ON playlist_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_playlist_items_updated_at BEFORE UPDATE ON playlist_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
