# MUXARO Database Configuration & Migration Path
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  

---

## 1. Dual-Environment Relational Architecture

MUXARO's 22-table relational model is engineered for seamless parity between zero-setup local development and managed cloud PostgreSQL:

| Environment | Engine | Location / Schema Source | Purpose |
| :--- | :--- | :--- | :--- |
| **Local Development & Automated QA** | Node 24 built-in `node:sqlite` (`DatabaseSync`, WAL mode, `PRAGMA foreign_keys = ON`) | `.muxaro-data/muxaro.db` initialized by `apps/api/src/db/database.ts` | Zero-dependency local persistence with ACID transactions (`BEGIN IMMEDIATE`), full 22-table parity |
| **Staging / Production Cloud** | **PostgreSQL 16** (`sslmode=require`) | `infra/scripts/init-db.sql` + `infra/migrations/002_account_rewards_analytics.sql` applied via `infra/scripts/run-migrations.sh` | Multi-instance concurrent persistence for Cloud Run API + Worker fleet |

---

## 2. Production Provider Options & Honest Free-Tier Caveats

### Option A: Supabase Free Tier (Recommended for Zero-Cost Staging / Initial Launch)
- **Allowance:** 500 MB PostgreSQL storage, pooled connections (Supavisor), automated TLS.
- **CRITICAL HONEST LIMITATION (Do Not Over-Promise):**
  > **Supabase Free Tier automatically pauses projects after 7 consecutive days of database inactivity.**
  > Therefore, MUXARO MUST NOT advertise a 99.9% always-on SLA while hosted on Supabase Free! A paused database causes `GET /api/v1/ready` to return unhealthy until manually resumed or upgraded.
- **Upgrade Trigger:** Upgrade to **Supabase Pro (~$25/mo)** or **Neon Launch / Google Cloud SQL** before committing to production always-on traffic or paid user tiers.

### Option B: Google Cloud SQL for PostgreSQL (Production Scale)
- Same GCP VPC as Cloud Run (`muxaro-api`) via Cloud SQL Auth Proxy / Private Service Connect; no inactivity pausing, automated point-in-time recovery (PITR), and daily encrypted backups.

---

## 3. Running Production Migrations Safely

```bash
export DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<db>?sslmode=require"
bash infra/scripts/run-migrations.sh
```
- `infra/scripts/run-migrations.sh` maintains a `schema_migrations` tracking table so `init-db.sql` and `002_account_rewards_analytics.sql` execute **idempotently** exactly once.
- **Backup & Restore Discipline:** Always snapshot the database prior to applying schema migrations; never run destructive `DROP TABLE` migrations in-place without a rollback script.
