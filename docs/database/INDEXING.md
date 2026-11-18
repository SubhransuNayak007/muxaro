# Database Indexing & Query Performance

**Project:** MUXARO  
**Source of Truth:** `apps/api/src/db/database.ts` (SQLite WAL) & `infra/migrations/002_account_rewards_analytics.sql` (PostgreSQL 16)

---

## 1. Complete Index Inventory (25 Secondary Indexes + 22 Primary Keys + Unique Constraints)

Every hot query path in `apps/api/src/services/` is backed by an explicit B-tree index created at database initialization:

| Table | Index Name (SQLite) | Indexed Columns | Primary Query Pattern Served |
| :--- | :--- | :--- | :--- |
| `users` | `idx_users_email` | `(email)` | Email login & duplicate registration lookup |
| `users` | `idx_users_public_id` | `(public_user_id)` | Admin support search (`MXR-...`), suspend/restore |
| `users` | `idx_users_status` | `(account_status)` | Admin user list filtered by status |
| `oauth_accounts` | `idx_oauth_accounts_user` | `(user_id)` | Fetching linked Google OAuth accounts for a user |
| `oauth_accounts` | *(Implicit `UNIQUE`)* | `(provider, provider_subject)` | OIDC callback subject resolution |
| `oauth_states` | `idx_oauth_states_expires` | `(expires_at)` | Expiring stale 10-min PKCE states |
| `user_sessions` | `idx_user_sessions_user` | `(user_id)` | Listing active device sessions & `logout-all` revocation |
| `user_sessions` | `idx_user_sessions_token` | `(token_hash)` | Per-request session authentication (`resolveRequestAuth`) |
| `email_verifications` | `idx_email_verifications_user` | `(user_id)` | Active verification code lookup & invalidation |
| `password_resets` | `idx_password_resets_user` | `(user_id)` | Active password reset lookup |
| `quota_reservations` | `idx_quota_res_user_bucket` | `(user_id, bucket, status, created_at)` | Rolling 24-hour base quota usage & earliest slot countdown |
| `credit_ledger` | `idx_credit_ledger_user` | `(user_id, created_at DESC)` | Paginated `/api/v1/credits/ledger` & FIFO lot reconstruction |
| `credit_ledger` | `idx_credit_ledger_expiry` | `(entry_type, expired_processed, expires_at)` | Sweeping expired reward credit grants |
| `reward_sessions` | `idx_reward_sessions_user` | `(user_id, status, created_at DESC)` | Active `PENDING` claim check + rolling 24h verified ad cap count |
| `reward_provider_events` | `idx_reward_events_session` | `(reward_session_id)` | Admin rewards audit & session callback correlation |
| `reward_provider_events` | *(Implicit `UNIQUE`)* | `(provider_transaction_id)` | Atomic O(log N) SSV replay detection |
| `media_assets` | `idx_media_assets_owner` | `(owner_user_id)` | Owner-scoped asset lookups |
| `batches` | `idx_batches_owner` | `(owner_user_id, created_at DESC)` | Paginated `GET /api/v1/batches` |
| `processing_jobs` | `idx_jobs_owner` | `(owner_user_id, created_at DESC)` | Paginated `GET /api/v1/account/history` |
| `processing_jobs` | `idx_jobs_batch` | `(batch_id, item_number)` | Ordered `001/002/003` child jobs in `GET /api/v1/batches/:id/jobs` |
| `processing_jobs` | `idx_jobs_status` | `(status, queue_class)` | Active/queued status counts & admin analytics |
| `processing_jobs` | `idx_jobs_request_id` | `(request_id)` | Support lookup by `req_...` in `GET /api/v1/admin/search` |
| `job_events` | `idx_job_events_job` | `(job_id, created_at)` | Ordered audit timeline per job |
| `output_artifacts` | `idx_artifacts_job` | `(job_id)` | Download artifact fallback resolution across restarts |
| `output_artifacts` | `idx_artifacts_owner` | `(owner_user_id)` | Owner-scoped artifact lookup |
| `security_events` | `idx_security_events_type` | `(event_type, created_at DESC)` | Admin security feed filtered by event type |
| `security_events` | `idx_security_events_user` | `(user_id, created_at DESC)` | Per-user abuse & IDOR history |
| `admin_audit_logs` | `idx_admin_audit_created` | `(created_at DESC)` | Paginated immutable admin audit log |
| `analytics_events` | `idx_analytics_name_created` | `(event_name, created_at DESC)` | DAU/MAU, job/download funnel aggregations |
| `analytics_events` | `idx_analytics_user_created` | `(user_id, created_at DESC)` | Cohort & user retention metrics |

---

## 2. Hot-Path Query Analysis & Optimization Notes

1. **Per-Request Session Validation (`auth.middleware.ts`):**
   - Joins `user_sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`.
   - Uses `idx_user_sessions_token` (unique index lookup) + PK lookup on `users(id)`.
   - `last_seen_at` writes are throttled to once per **60 seconds** (`LAST_SEEN_TOUCH_INTERVAL_MS = 60_000`) to avoid turning read-only `GET` requests into SQLite write transactions.
2. **Rolling 24-Hour Quota Calculation (`entitlements.service.ts`):**
   - `WHERE user_id = ? AND bucket = ? AND source = 'base' AND status IN ('RESERVED', 'COMMITTED') AND created_at > ? ORDER BY created_at ASC` directly hits the leading composite index `idx_quota_res_user_bucket(user_id, bucket, status, created_at)`.
3. **Admin Support Search Caveat (`admin.service.ts`):**
   - Exact lookups (`id = ?`, `request_id = ?`, `upper(public_user_id) = ?`) are fast; note that `upper(public_user_id)` and `lower(email) LIKE lower(?)` can bypass case-sensitive indexes in SQLite unless normalized before querying (all emails are stored lowercase and `MXR-`/`MXB-`/`MXJ-` IDs are stored uppercase).
   - **Recommended Future Index Improvements *(Planned)*:**
     - Add `(expires_at)` index on `output_artifacts` for scheduled expired-artifact sweeps at scale.
     - Add `(user_id, status, expires_at)` index on `quota_reservations` for `expireStaleReservationsInTx()`.
     - Add functional indexes (`LOWER(email)`, `UPPER(public_user_id)`) or `COLLATE NOCASE` if admin search volume grows beyond tens of thousands of rows.
