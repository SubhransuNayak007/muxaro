# Database Schema Reference

**Project:** MUXARO  
**Active Runtime Engine:** SQLite via Node 24 built-in `node:sqlite` (`DatabaseSync`) — `apps/api/src/db/database.ts`  
**Default Database Path:** `.muxaro-data/muxaro.db` (override via `MUXARO_DB_PATH`)  
**PostgreSQL Parity Mirror:** `infra/migrations/002_account_rewards_analytics.sql` (22 identical logical tables)

---

## 1. Runtime Pragmas & Transaction Discipline

Initialized automatically on boot by `getDb()` (`apps/api/src/db/database.ts`):
- `PRAGMA journal_mode = WAL;` — Concurrent readers alongside serialized writers.
- `PRAGMA foreign_keys = ON;` — Enforces `ON DELETE CASCADE` and `ON DELETE SET NULL`.
- `PRAGMA busy_timeout = 5000;` — 5-second lock wait under concurrent write contention.
- **Atomic Transactions:** `runInTransaction(fn)` wraps multi-statement writes in `BEGIN IMMEDIATE ... COMMIT` (rolling back on error) so quota checks, credit ledger writes, OAuth state consumption, and reward SSV settlement are strictly serializable without race conditions.

---

## 2. Complete 22-Table Schema Catalog

### Domain A — Identity, Authentication & Security (Tables 1–7)

#### 1. `users`
Stores registered accounts with dual identifiers (UUIDv7 internal PK + non-sequential `MXR-XXXXXXXX` public ID).
| Column | Type | Constraints / Default | Purpose |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY` | RFC 9562 UUIDv7 internal identifier |
| `public_user_id` | `TEXT` | `NOT NULL UNIQUE` | Customer-safe `MXR-XXXXXXXX` identifier |
| `email` | `TEXT` | `NOT NULL UNIQUE` | Normalized lowercase email |
| `email_verified` | `INTEGER` | `NOT NULL DEFAULT 0` | `0` or `1` (`BOOLEAN` in PostgreSQL) |
| `password_hash` | `TEXT` | Nullable | `$argon2id$...` or `$scrypt$...` (`NULL` for OAuth-only accounts) |
| `display_name` | `TEXT` | Nullable | Sanitized display name (<= 80 chars) |
| `avatar_url` | `TEXT` | Nullable | Optional profile avatar URL |
| `role` | `TEXT` | `NOT NULL DEFAULT 'USER'` | `USER`, `PRO`, `ADMIN` |
| `tier` | `TEXT` | `NOT NULL DEFAULT 'FREE'` | `FREE`, `PREMIUM`, `PRO`, `ADMIN` |
| `account_status` | `TEXT` | `NOT NULL DEFAULT 'ACTIVE'` | `ACTIVE`, `SUSPENDED`, `DELETED` |
| `preferences_json` | `TEXT` | `NOT NULL DEFAULT '{}'` | User preferences JSON (`JSONB` in PG) |
| `mfa_enabled` | `INTEGER` | `NOT NULL DEFAULT 0` | Whether RFC 6238 TOTP MFA is active |
| `created_at`, `updated_at` | `TEXT` | `NOT NULL` | ISO-8601 UTC timestamps |
| `deleted_at` | `TEXT` | Nullable | Soft-delete timestamp |

#### 2. `oauth_accounts`
Links external OIDC providers (Google) to `users`.
| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY` | Prefixed opaque ID |
| `user_id` | `TEXT` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Owning user |
| `provider` | `TEXT` | `NOT NULL`, `UNIQUE(provider, provider_subject)` | e.g., `'google'` |
| `provider_subject` | `TEXT` | `NOT NULL`, `UNIQUE(provider, provider_subject)` | Google `sub` claim |
| `email`, `email_verified`, `profile_json` | `TEXT`/`INTEGER` | Defaults `0` / `'{}'` | Verified OIDC profile snapshot |
| `created_at`, `updated_at` | `TEXT` | `NOT NULL` | ISO-8601 UTC |

#### 3. `oauth_states`
Single-use server-side PKCE (`S256`) state and OIDC `nonce` records (10-min TTL).
- Columns: `state` (`PK`), `nonce`, `code_verifier`, `return_to` (`DEFAULT '/'`), `ip_prefix`, `expires_at`, `consumed_at`, `created_at`.

#### 4. `user_sessions`
Active cookie/Bearer sessions (30-day TTL). Zero plaintext tokens stored.
- Columns: `id` (`PK`), `user_id` (`FK -> users.id ON DELETE CASCADE`), `token_hash` (`NOT NULL UNIQUE`, SHA-256 hex), `csrf_token` (`NOT NULL`), `mfa_verified` (`DEFAULT 0`), `user_agent`, `ip_prefix`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`.

#### 5. `email_verifications`
Single-use hashed 6-digit email verification codes and tokens (15-min TTL, max 5 attempts).
- Columns: `id` (`PK`), `user_id` (`FK -> users.id ON DELETE CASCADE`), `email`, `token_hash` (`UNIQUE`), `code_hash`, `attempts` (`DEFAULT 0`), `max_attempts` (`DEFAULT 5`), `expires_at`, `consumed_at`, `created_at`.

#### 6. `password_resets`
Single-use hashed password reset tokens (30-min TTL).
- Columns: `id` (`PK`), `user_id` (`FK -> users.id ON DELETE CASCADE`), `token_hash` (`UNIQUE`), `attempts` (`DEFAULT 0`), `expires_at`, `consumed_at`, `created_at`.

#### 7. `user_mfa`
TOTP MFA enrollment per user.
- Columns: `user_id` (`PK`, `FK -> users.id ON DELETE CASCADE`), `secret` (AES-256-GCM ciphertext `v1:<iv>:<tag>:<enc>`), `enabled` (`DEFAULT 0`), `backup_codes_json` (`DEFAULT '[]'`), `verified_at`, `created_at`, `updated_at`.

---

### Domain B — Entitlements, Quotas & Rewarded Credits (Tables 8–12)

#### 8. `entitlements`
Materialized per-user/guest allowance snapshot synchronized inside every quota evaluation.
- Columns: `user_id` (`PK`), `tier` (`DEFAULT 'FREE'`), `base_individual_limit` (`DEFAULT 10`), `base_playlist_limit` (`DEFAULT 1`), `max_concurrent_jobs` (`DEFAULT 2`), `extra_credits_balance` (`DEFAULT 0`), `updated_at`.

#### 9. `quota_reservations`
Two-phase atomic rolling 24-hour reservation ledger (30-min TTL for uncommitted reservations).
- Columns: `id` (`PK`), `user_id`, `bucket` (`'video'` / `'playlist'` in runtime SQLite; `'individual'` / `'playlist'` check in PG migration 002), `units` (`DEFAULT 1`), `source` (`'base'` / `'extra'` in runtime SQLite; `'base'` / `'reward'` in PG migration 002), `status` (`RESERVED`, `COMMITTED`, `RELEASED`, `EXPIRED`), `idempotency_key` (`UNIQUE`), `reference_id`, `reason`, `expires_at`, `created_at`, `updated_at`.

#### 10. `credit_ledger` *(Strictly Immutable / Append-Only)*
Audit trail for every credit grant, reservation, consumption, release, admin adjustment, and FIFO expiration. Runtime code **never** executes `UPDATE` or `DELETE` on `credit_ledger`.
- Columns: `id` (`PK`), `user_id`, `entry_type` (`REWARD_GRANTED`, `CREDIT_RESERVED`, `CREDIT_CONSUMED`, `CREDIT_RELEASED`, `ADMIN_ADJUSTMENT`, `CREDIT_EXPIRED`), `delta`, `remaining_delta`, `balance_after`, `reference_id`, `reason`, `expires_at`, `expired_processed`, `created_at`.

#### 11. `reward_sessions`
Google Ad Manager rewarded ad sessions (`MXRWD-XXXXXXXXXXXX`, 10-min TTL).
- Columns: `id` (`PK`), `user_id`, `provider` (`DEFAULT 'gam'`), `ad_unit_path`, `status` (`PENDING`, `VERIFIED`, `EXPIRED`, `REJECTED`), `reward_amount` (`DEFAULT 2`), `custom_data_hash` (SHA-256 of signed `custom_data`), `provider_transaction_id`, `ip_prefix`, `expires_at`, `verified_at`, `created_at`, `updated_at`.

#### 12. `reward_provider_events`
Replay-protected log of every incoming GAM SSV callback.
- Columns: `id` (`PK`), `provider_transaction_id` (`NOT NULL UNIQUE` — atomic replay guard), `reward_session_id`, `user_id`, `key_id`, `signature_valid` (`0`/`1`), `status`, `raw_summary_json` (redacted), `created_at`.

---

### Domain C — Media Assets, Batches, Jobs & Artifacts (Tables 13–17)

#### 13. `media_assets`
Schema table for inspected/uploaded media metadata.
- Columns: `id` (`PK`), `owner_user_id`, `source_type`, `source_url`, `local_file_path`, `title`, `author`, `container`, `duration_seconds`, `file_size_bytes`, `manifest_json`, `expires_at`, `created_at`.
- *(Note: Currently `AdapterService` caches inspected manifests primarily in memory (`assetCache`) with 60-min TTL for local uploads; the table is initialized and ready for persistent asset indexing.)*

#### 14. `batches`
Parent records for tracked multi-item batches (`MXB-YYYYMMDD-XXXXXX`).
- Columns: `id` (`PK`), `owner_user_id`, `owner_tier`, `title`, `source_url`, `status`, `total_items`, `completed_items`, `failed_items`, `cancelled_items`, `progress`, `zip_download_url`, `zip_file_path`, `zip_filename`, `zip_size_bytes`, `retention_minutes` (`DEFAULT 60`), `idempotency_key` (`UNIQUE`), `error_message`, `created_at`, `updated_at`, `completed_at`, `expires_at`.

#### 15. `processing_jobs`
Canonical persistent table for all individual, merge, and batch-child jobs (`MXJ-XXXXXXXXXX`).
- Columns (44 total): `id` (`PK`), `owner_user_id`, `owner_tier`, `batch_id` (`FK -> batches(id) ON DELETE SET NULL`), `item_number`, `media_asset_id`, `media_url`, `local_file_path`, `audio_url`, `audio_offset_ms`, `input_title`, `operation`, `target_format`, `target_resolution`, `target_audio_codec`, `stream_copy`, `format_id`, `processing_lane`, `queue_class`, `strategy_label`, `lossless_preserved`, `retention_minutes`, `priority_weight`, `status`, `progress`, `stage`, `stage_message`, `idempotency_key`, `reservation_id`, `request_id`, `attempts`, `max_attempts`, `queued_at`, `started_at`, `queue_wait_ms`, `processing_ms`, `download_url`, `error_code`, `error_message`, `user_message`, `created_at`, `updated_at`, `completed_at`, `expires_at`.

#### 16. `job_events`
Append-only timeline of job state and progress transitions.
- Columns: `id` (`PK`), `job_id` (`FK -> processing_jobs(id) ON DELETE CASCADE`), `status`, `progress`, `stage`, `message`, `created_at`.

#### 17. `output_artifacts`
Verified output files persisted for signed download resolution across restarts.
- Columns: `id` (`PK`), `job_id`, `owner_user_id`, `file_path`, `filename`, `mime_type`, `size_bytes`, `container`, `codec`, `duration_seconds`, `checksum_sha256`, `download_url`, `expires_at`, `created_at`.

---

### Domain D — Rate Limiting, Security, Governance & Analytics (Tables 18–22)

#### 18. `rate_limit_counters`
Atomic cross-restart rate limit buckets (keyed by HMAC-SHA256 hash).
- Columns: `bucket_key` (`PK`), `hits`, `window_start_ms`, `window_ms`, `blocked_until_ms`, `updated_at`.

#### 19. `security_events`
Redacted security telemetry (`BRUTE_FORCE`, `RATE_LIMIT_SPIKE`, `IDOR_ATTEMPT`, `DUPLICATE_FLOOD`, `CSRF_REJECTED`, `ADMIN_ACCESS_DENIED`, `ADMIN_MFA_REQUIRED`, `REWARD_REPLAY_DETECTED`, etc.).
- Columns: `id` (`PK`), `event_type`, `severity`, `user_id`, `public_user_id`, `ip_prefix`, `endpoint`, `request_id`, `details_json`, `created_at`.

#### 20. `admin_audit_logs` *(Strictly Immutable / Append-Only)*
Records every admin mutation (user suspend/restore/revoke, settings update, env admin bootstrap promotion) with redacted `before_json` and `after_json`.
- Columns: `id` (`PK`), `admin_user_id`, `admin_public_id`, `action`, `target_type`, `target_id`, `before_json`, `after_json`, `request_id`, `created_at`.

#### 21. `system_settings`
16 live admin-configurable policy keys seeded via `INSERT OR IGNORE` on startup:
`base_individual_limit` (`10`), `guest_individual_limit` (`3`), `premium_individual_limit` (`100`), `base_playlist_limit` (`1`), `guest_playlist_limit` (`0`), `premium_playlist_limit` (`10`), `reward_credits_per_ad` (`2`), `reward_daily_cap` (`3`), `reward_expiry_hours` (`24`), `guest_max_concurrent` (`1`), `free_max_concurrent` (`2`), `premium_max_concurrent` (`5`), `max_upload_size_mb` (`2048`), `max_playlist_items` (`50`), `rewarded_ads_enabled` (`true`), `artifact_retention_minutes` (`60`).

#### 22. `analytics_events`
Privacy-safe server-side KPI events (`job_created`, `download_started`, etc.) powering Admin Control Centre DAU/MAU, retention, and funnel aggregations.
- Columns: `id` (`PK`), `event_name`, `user_id`, `tier`, `properties_json`, `created_at`.

---

## 3. Data Retention Policies

| Data Store / Table | Retention Policy | Enforcement Mechanism |
| :--- | :--- | :--- |
| `.muxaro-artifacts/<jobId>/` | 60 minutes (`artifact_retention_minutes`) | Per-job cleanup timer in `QueueService` + immediate cleanup on failure/cancel |
| `.muxaro-uploads/<assetId>/` | 60 minutes (`UPLOAD_TTL_MS`) | Cleanup timer in `AdapterService` + multipart timer in `media.ts` |
| `oauth_states` | 10 minutes (`OAUTH_STATE_TTL_MS`) | Expiry checked on callback + single-use `consumed_at` |
| `email_verifications` / `password_resets` | 15 min / 30 min | Expiry checked on verify + single-use `consumed_at` |
| `user_sessions` | 30 days (`SESSION_TTL_MS`) | Expiry checked on every `resolveRequestAuth` + explicit `revoked_at` |
| `reward_sessions` | 10 minutes (`REWARD_SESSION_TTL_SECONDS`) | Auto-transitioned to `EXPIRED` before new claim or status fetch |
| `rate_limit_counters` | 1 hour past window end | 60-second background GC in `SqliteHybridRateLimitBackend` |
| `credit_ledger` & `admin_audit_logs` | Permanent (append-only) | Never updated or deleted by application code |
