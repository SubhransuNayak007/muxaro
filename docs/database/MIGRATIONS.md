# Database Migrations & Schema Evolution

**Project:** MUXARO  
**Scope:** Runtime SQLite Auto-Initialization & Provisioned PostgreSQL Migration Pipeline

---

## 1. Active Runtime Initialization (SQLite WAL)

In the active `apps/api` runtime (`apps/api/src/db/database.ts`), schema initialization is idempotent and runs automatically during `buildApp()` via `getDb()`:

1. Ensures parent directory `.muxaro-data/` exists (unless `MUXARO_DB_PATH=:memory:` in tests).
2. Opens `new DatabaseSync(targetPath)` using Node 24's built-in `node:sqlite`.
3. Executes `SCHEMA_SQL` containing `PRAGMA` directives and `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` for all **22 tables**.
4. Seeds all **16 default rows** in `system_settings` via `INSERT OR IGNORE` (`seedSystemSettings()`), preserving any admin-customized settings across restarts.

> **Operational Caveat for SQLite Evolutions:** Because `SCHEMA_SQL` uses `CREATE TABLE IF NOT EXISTS`, adding a new column to an existing table on a live `.muxaro-data/muxaro.db` requires an explicit `ALTER TABLE` check (inspecting `PRAGMA table_info(<table>)`) or a fresh versioned migration ledger before deploying breaking column additions.

---

## 2. Provisioned PostgreSQL 16 Migration Pipeline (`infra/`)

The repository contains a complete idempotent PostgreSQL migration pipeline for Docker Compose (`infra/docker-compose.yml`) and cloud RDS/PostgreSQL deployments:

### 2.1 Migration Files in Repository

| File Path | Role | Scope |
| :--- | :--- | :--- |
| `infra/scripts/init-db.sql` | Base PostgreSQL schema (`uuid-ossp`, `pgcrypto`) | Initial core tables (`users`, `user_roles`, `media_assets`, `media_streams`, `processing_jobs`, `output_artifacts`, `playlist_jobs`, `playlist_items`, etc.) mounted into `/docker-entrypoint-initdb.d/` |
| `infra/migrations/002_account_rewards_analytics.sql` | Migration `002` — Full Account Platform & Analytics | Creates/alters all **22 tables** matching `apps/api/src/db/database.ts` (`users`, `oauth_accounts`, `oauth_states`, `user_sessions`, `email_verifications`, `password_resets`, `user_mfa`, `entitlements`, `quota_reservations`, `credit_ledger`, `reward_sessions`, `reward_provider_events`, `media_assets`, `batches`, `processing_jobs`, `job_events`, `output_artifacts`, `rate_limit_counters`, `security_events`, `admin_audit_logs`, `system_settings`, `analytics_events`) and seeds all 16 `system_settings` rows |
| `docs/architecture/schema.sql` | Reference Architecture DDL | Historical base architecture blueprint DDL (PostgreSQL 16) |
| `infra/scripts/run-migrations.sh` | Automated Migration Runner | Waits for `pg_isready`, creates `schema_migrations(filename PK, applied_at)`, applies `init-db.sql`, and applies each unapplied `infra/migrations/*.sql` file in lexicographical order with `ON_ERROR_STOP=1` |

### 2.2 Running PostgreSQL Migrations (Docker / Staging)

```bash
# Against Docker Compose PostgreSQL service
POSTGRES_HOST=localhost \
POSTGRES_PORT=5432 \
POSTGRES_USER=muxaro_user \
POSTGRES_DB=muxaro_db \
POSTGRES_PASSWORD=<your-password> \
sh infra/scripts/run-migrations.sh
```

### 2.3 Schema Parity Note (SQLite vs. PostgreSQL Migration 002)

When transitioning the runtime API driver from `node:sqlite` to PostgreSQL *(Planned)*, reconcile two minor `CHECK` enum differences already visible between `apps/api/src/services/entitlements.service.ts` and `infra/migrations/002_account_rewards_analytics.sql`:

| Table / Column | Active SQLite Runtime Values | PostgreSQL `002_*.sql` `CHECK` Values | Action Needed Before PG Cutover |
| :--- | :--- | :--- | :--- |
| `quota_reservations.bucket` | `'video'`, `'playlist'` | `'individual'`, `'playlist'` | Align `CHECK` constraint or map `'video'` ↔ `'individual'` |
| `quota_reservations.source` | `'base'`, `'extra'` | `'base'`, `'reward'` | Align `CHECK` constraint or map `'extra'` ↔ `'reward'` |
| `reward_provider_events.status` | Includes `'REJECTED_INVALID_SIGNATURE'` | `'ACCEPTED'`, `'DUPLICATE'`, `'REJECTED'` | Broaden `CHECK` or normalize status string |

---

## 3. Safe Migration Checklist for Contributors

1. **Additive First:** Always prefer adding nullable columns or columns with explicit `DEFAULT` values before backfilling and removing old columns.
2. **Idempotent SQL:** Wrap PostgreSQL migrations in `BEGIN; ... COMMIT;` and use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`.
3. **Keep Parity:** Any new table, column, or index added to `apps/api/src/db/database.ts` must be mirrored in a new numbered SQL file under `infra/migrations/003_<name>.sql`.
4. **Never Mutate Immutable Tables:** Never run destructive `UPDATE` or `DELETE` migrations against `credit_ledger` or `admin_audit_logs`.
