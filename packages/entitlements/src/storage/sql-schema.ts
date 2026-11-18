/**
 * @file sql-schema.ts
 * PostgreSQL DDL schemas, constraints, and indexes for persistent database backends
 * Directly corresponds to Section 19 of docs/MASTER_PRD.md
 */

export const POSTGRES_ENTITLEMENTS_SCHEMA = `
-- ============================================================================
-- Project MUXARO - Entitlements, Sessions, Quotas, and Ledgers (PostgreSQL DDL)
-- ============================================================================

-- Extensions required
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- User Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'free',
    tier VARCHAR(32) NOT NULL DEFAULT 'free',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- Tier Entitlements Configuration Table
CREATE TABLE IF NOT EXISTS entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL,
    entitlement_type VARCHAR(64) NOT NULL, -- 'video' | 'playlist'
    allowance INT NOT NULL,
    window_seconds INT NOT NULL DEFAULT 86400,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_entitlement_type ON entitlements (user_id, entitlement_type)
    WHERE effective_until IS NULL;

-- Two-Phase Quota Reservations Table
CREATE TABLE IF NOT EXISTS quota_reservations (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    job_id VARCHAR(64),
    idempotency_key VARCHAR(128),
    job_type VARCHAR(64) NOT NULL,
    bucket VARCHAR(32) NOT NULL, -- 'video' | 'playlist'
    cost INT NOT NULL DEFAULT 1,
    item_count INT NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'COMMITTED' | 'ROLLED_BACK' | 'EXPIRED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    committed_at TIMESTAMPTZ,
    rolled_back_at TIMESTAMPTZ,
    rollback_reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_reservations_user_bucket_status ON quota_reservations (user_id, bucket, status);
CREATE INDEX IF NOT EXISTS idx_reservations_job_id ON quota_reservations (job_id);
CREATE INDEX IF NOT EXISTS idx_reservations_user_idempotency ON quota_reservations (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_reservations_expires_at ON quota_reservations (expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_reservations_window_eval ON quota_reservations (user_id, bucket, committed_at) 
    WHERE status = 'COMMITTED';

-- Server-Side Idempotency Keys Table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(128) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PROCESSING', -- 'PROCESSING' | 'COMPLETED' | 'FAILED'
    job_id VARCHAR(64),
    reservation_id VARCHAR(64),
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys (expires_at);

-- Transparent Audit & Credit Transaction Ledger Table (Append-Only)
CREATE TABLE IF NOT EXISTS credit_ledger (
    id VARCHAR(64) PRIMARY KEY,
    sequence_number BIGSERIAL NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    bucket VARCHAR(32) NOT NULL,
    amount INT NOT NULL,
    balance_after INT NOT NULL,
    reservation_id VARCHAR(64),
    job_id VARCHAR(64),
    idempotency_key VARCHAR(128),
    reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_seq ON credit_ledger (user_id, sequence_number DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_created_at ON credit_ledger (created_at);

-- User Credit Balances Table (For future expansion)
CREATE TABLE IF NOT EXISTS user_credit_balances (
    user_id VARCHAR(64) PRIMARY KEY,
    balance INT NOT NULL DEFAULT 0,
    currency VARCHAR(16) NOT NULL DEFAULT 'CREDITS',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
