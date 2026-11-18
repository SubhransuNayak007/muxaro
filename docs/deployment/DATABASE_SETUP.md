# MUXARO Database Setup & Migration Guide

**SQLite Local Engine:** `apps/api/src/db/database.ts` (Node 24 built-in `node:sqlite`, WAL mode, 22 relational tables)  
**PostgreSQL Production Schema & Runner:** `infra/scripts/init-db.sql`, `infra/migrations/002_account_rewards_analytics.sql`, `infra/scripts/run-migrations.sh`

---

## 1. Current Runtime Engine vs. Production PostgreSQL Path (Honest State)

| Environment | Engine | Implementation Status | Notes |
| :--- | :--- | :--- | :--- |
| **Local Development & QA** | **SQLite WAL** (Node 24 `node:sqlite` `DatabaseSync`) | **Implemented & Active** | Zero external dependencies; auto-initializes `.muxaro-data/muxaro.db` on API boot with `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`, and `BEGIN IMMEDIATE` atomic transactions. |
| **Production Cloud Target** | **PostgreSQL 16** (Supabase or Cloud SQL, `sslmode=require`) | **DDL & Migration Runner Ready; Runtime Driver Pending** | `infra/scripts/init-db.sql`, `infra/migrations/002_account_rewards_analytics.sql`, and `infra/scripts/run-migrations.sh` define the 22-table PostgreSQL schema. However, `apps/api/src/db/database.ts` currently executes only against `node:sqlite` (`apps/api/package.json` does not yet bundle a `pg` runtime adapter). For stateless multi-replica Cloud Run deployments (`maxScale > 1`), complete the PostgreSQL runtime adapter before scaling out. |

---

## 2. Local SQLite Setup (Zero Configuration)

When `apps/api` starts (`npm run dev` or `npm start`), `getDb()` in `apps/api/src/db/database.ts`:
1. Creates the directory for `MUXARO_DB_PATH` (default: `.muxaro-data/muxaro.db`).
2. Executes `SCHEMA_SQL` idempotently (`CREATE TABLE IF NOT EXISTS` for all 22 tables + indexes).
3. Seeds `DEFAULT_SYSTEM_SETTINGS` (`base_individual_limit=10`, `guest_individual_limit=3`, `premium_individual_limit=100`, `base_playlist_limit=1`, `reward_credits_per_ad=2`, `reward_daily_cap=3`, `max_upload_size_mb=2048`, `max_playlist_items=50`, `artifact_retention_minutes=60`, etc.).

To reset your local development database cleanly:

```bash
rm -rf .muxaro-data/
# Restart apps/api to recreate a fresh database
```

---

## 3. PostgreSQL 16 Setup (Docker Compose / Cloud)

### 3.1 Local PostgreSQL via Docker Compose (`infra/docker-compose.yml`)
Docker Compose provisions `postgres:16-alpine` on port `5432` and mounts `infra/scripts/init-db.sql` automatically:

```bash
cd infra
docker compose up -d postgres
```

### 3.2 Applying Ordered SQL Migrations (`infra/scripts/run-migrations.sh`)
`infra/scripts/run-migrations.sh` creates a `schema_migrations` tracking table, applies `init-db.sql`, and runs each `infra/migrations/*.sql` file idempotently exactly once:

```bash
export POSTGRES_HOST="<db-host>"
export POSTGRES_PORT="5432"
export POSTGRES_USER="muxaro_user"
export POSTGRES_DB="muxaro_db"
export POSTGRES_PASSWORD="<strong-password>"

sh infra/scripts/run-migrations.sh
```

---

## 4. Managed PostgreSQL Provider Options & Caveats

### Option A: Supabase Free Tier (Staging / Low-Traffic Launch)
- 500 MB storage, Supavisor connection pooling, TLS enforced (`sslmode=require`).
- **Important Limitation:** Supabase Free projects automatically pause after **7 consecutive days of inactivity**. Do not advertise an always-on SLA while running on the free tier; upgrade to Supabase Pro or Cloud SQL for production workloads.

### Option B: Google Cloud SQL for PostgreSQL (Production Scale)
- Co-located in the same GCP region (`us-central1`) as Cloud Run `muxaro-api`, connected over Cloud SQL Auth Proxy / Private Service Connect, with automated daily backups and Point-in-Time Recovery (PITR).

---

## 5. Backup & Migration Safety Policy

1. Always capture a database snapshot prior to applying schema migrations.
2. Keep migrations strictly **additive and backward-compatible** (`CREATE TABLE IF NOT EXISTS`, nullable columns) so application container rollbacks never break schema compatibility.
3. Never execute destructive `DROP TABLE` rollbacks on production data; restore from PITR snapshots if corruption occurs.
