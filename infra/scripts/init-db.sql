-- ==============================================================================
-- MUXARO Production PostgreSQL Schema Initialization
-- Compliant with PRD Section 19: Database Architecture
-- ==============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. Users and Authentication
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_provider VARCHAR(50) NOT NULL DEFAULT 'local',
    provider_subject VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    display_name VARCHAR(100),
    account_status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, BANNED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(identity_provider, provider_subject);

-- User Roles
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'USER', -- USER, PRO, ADMIN
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_role UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);

-- ------------------------------------------------------------------------------
-- 2. Media Assets and Streams
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    source_type VARCHAR(50) NOT NULL, -- DIRECT_URL, USER_UPLOAD, AUTHORIZED_OEMBED
    source_reference TEXT NOT NULL,
    storage_key VARCHAR(500),
    original_filename VARCHAR(255),
    container VARCHAR(30),
    duration_seconds NUMERIC(10, 2) DEFAULT 0.00,
    file_size_bytes BIGINT DEFAULT 0,
    video_codec VARCHAR(50),
    audio_codec VARCHAR(50),
    width INTEGER,
    height INTEGER,
    frame_rate NUMERIC(6, 2),
    inspection_status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_owner ON media_assets(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_status ON media_assets(inspection_status);
CREATE INDEX IF NOT EXISTS idx_media_assets_expires ON media_assets(expires_at);

-- Media Streams (detailed per-stream analysis)
CREATE TABLE IF NOT EXISTS media_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    stream_index INTEGER NOT NULL,
    stream_type VARCHAR(20) NOT NULL, -- VIDEO, AUDIO, SUBTITLE, ATTACHMENT
    codec VARCHAR(50) NOT NULL,
    bitrate BIGINT,
    width INTEGER,
    height INTEGER,
    sample_rate INTEGER,
    channels INTEGER,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_streams_asset ON media_streams(media_asset_id);

-- ------------------------------------------------------------------------------
-- 3. Processing Jobs and Artifacts
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    media_asset_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
    job_type VARCHAR(50) NOT NULL, -- REMUX, AUDIO_EXTRACT, TRANSCODE, MERGE
    status VARCHAR(30) NOT NULL DEFAULT 'CREATED', -- CREATED, VALIDATING, QUEUED, PROCESSING, VERIFYING, READY, FAILED, CANCELLED
    priority INTEGER NOT NULL DEFAULT 5, -- 1 (lowest) to 10 (highest)
    operation VARCHAR(50) NOT NULL,
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key VARCHAR(128) UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0,
    progress NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    error_code VARCHAR(100),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON processing_jobs(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_owner ON processing_jobs(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON processing_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON processing_jobs(created_at);

-- Output Artifacts
CREATE TABLE IF NOT EXISTS output_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processing_job_id UUID NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
    storage_key VARCHAR(500) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    checksum VARCHAR(128),
    container VARCHAR(30) NOT NULL,
    codec VARCHAR(50),
    duration_seconds NUMERIC(10, 2),
    download_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_job ON output_artifacts(processing_job_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_expires ON output_artifacts(expires_at);

-- ------------------------------------------------------------------------------
-- 4. Playlists and Batch Jobs
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playlist_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled Playlist',
    source_reference TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    total_items INTEGER NOT NULL DEFAULT 0,
    completed_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    cancelled_items INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playlist_jobs_owner ON playlist_jobs(owner_user_id);

CREATE TABLE IF NOT EXISTS playlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_job_id UUID NOT NULL REFERENCES playlist_jobs(id) ON DELETE CASCADE,
    media_asset_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
    processing_job_id UUID REFERENCES processing_jobs(id) ON DELETE SET NULL,
    position INTEGER NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    error_code VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_job_id, position);

-- ------------------------------------------------------------------------------
-- 5. Entitlements, Quotas and Credit Ledger
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entitlement_type VARCHAR(50) NOT NULL, -- INDIVIDUAL_VIDEO, PLAYLIST
    allowance INTEGER NOT NULL DEFAULT 10,
    window_seconds INTEGER NOT NULL DEFAULT 86400, -- Rolling 24 hours
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_entitlement UNIQUE (user_id, entitlement_type)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);

-- Atomic Quota Reservations
CREATE TABLE IF NOT EXISTS quota_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entitlement_type VARCHAR(50) NOT NULL,
    job_id UUID REFERENCES processing_jobs(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'RESERVED', -- RESERVED, CONSUMED, RELEASED
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quota_reservations_window ON quota_reservations(user_id, entitlement_type, reserved_at);

-- Credit Ledger
CREATE TABLE IF NOT EXISTS credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL, -- ALLOCATION, CONSUMPTION, REFUND, ADJUSTMENT
    amount INTEGER NOT NULL,
    reference_type VARCHAR(50), -- JOB, SUBSCRIPTION, ADMIN
    reference_id UUID,
    idempotency_key VARCHAR(128) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id);

-- ------------------------------------------------------------------------------
-- 6. Audit Logs & Outbox Events
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    request_id VARCHAR(100),
    ip_metadata JSONB DEFAULT '{}'::jsonb,
    user_agent_metadata JSONB DEFAULT '{}'::jsonb,
    details_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Outbox Events (for transactional event publishing)
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload_json JSONB NOT NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox_events(created_at) WHERE published_at IS NULL;

-- ------------------------------------------------------------------------------
-- Seed Default Admin & System Role
-- ------------------------------------------------------------------------------
INSERT INTO users (id, identity_provider, provider_subject, email, email_verified, display_name, account_status)
VALUES 
    ('00000000-0000-0000-0000-000000000001', 'system', 'sys-admin', 'admin@muxaro.internal', true, 'System Administrator', 'ACTIVE')
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_roles (user_id, role)
VALUES 
    ('00000000-0000-0000-0000-000000000001', 'ADMIN')
ON CONFLICT (user_id, role) DO NOTHING;
