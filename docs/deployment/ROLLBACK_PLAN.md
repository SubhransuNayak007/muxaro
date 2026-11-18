# MUXARO Production Rollback & Emergency Incident Runbook

**Emergency Halt Script:** `infra/scripts/emergency-shutdown.sh`  
**Scope:** Cloudflare Pages (`muxaro`), Google Cloud Run (`muxaro-api`, `muxaro-worker`), PostgreSQL/SQLite Database, Cloudflare R2.

---

## 1. Immediate Emergency Traffic Halt (Under 60 Seconds)

If MUXARO experiences an active DDoS/abuse wave, runaway compute spend, or critical vulnerability, halt public API traffic and cap Cloud Run scale immediately:

```bash
# Preview exact commands first (dry run)
GCP_PROJECT_ID="your-gcp-project-id" GCP_REGION="us-central1" \
  ./infra/scripts/emergency-shutdown.sh --dry-run

# Execute emergency traffic halt (moves muxaro-api to internal-only, minScale=0, maxScale=1)
GCP_PROJECT_ID="your-gcp-project-id" GCP_REGION="us-central1" \
  ./infra/scripts/emergency-shutdown.sh

# Optional: also strip public allUsers IAM invoker + enable Cloudflare Under-Attack mode
GCP_PROJECT_ID="your-gcp-project-id" GCP_REGION="us-central1" \
  CLOUDFLARE_ZONE_ID="..." CLOUDFLARE_API_TOKEN="..." \
  ./infra/scripts/emergency-shutdown.sh --revoke-public
```

To restore normal traffic after mitigation:

```bash
GCP_PROJECT_ID="your-gcp-project-id" GCP_REGION="us-central1" \
  ./infra/scripts/emergency-shutdown.sh --restore
```

---

## 2. Fast Rollback Procedures by Layer

### A. Frontend Rollback (Cloudflare Pages — ~10 Seconds)

Every Cloudflare Pages deployment is immutable.
1. Open **Cloudflare Dashboard -> Workers & Pages -> `muxaro` -> Deployments**.
2. Locate the last known-good production deployment hash.
3. Click **`...` -> Rollback to this deployment**.
4. Verify `https://muxaro.app/` returns HTTP `200` and browser DevTools shows zero console/API errors.

### B. API & Worker Rollback (Google Cloud Run — ~15 Seconds)

Cloud Run retains previous container revisions automatically.

```bash
export GCP_PROJECT_ID="your-gcp-project-id"
export GCP_REGION="us-central1"

# 1. List recent revisions
gcloud run revisions list --service=muxaro-api --region="$GCP_REGION" --limit=5

# 2. Route 100% of traffic back to the previous healthy revision immediately
gcloud run services update-traffic muxaro-api \
  --region="$GCP_REGION" \
  --to-revisions="PREVIOUS_HEALTHY_REVISION=100"

# 3. Same for internal worker if worker regression occurred
gcloud run revisions list --service=muxaro-worker --region="$GCP_REGION" --limit=5
gcloud run services update-traffic muxaro-worker \
  --region="$GCP_REGION" \
  --to-revisions="PREVIOUS_HEALTHY_WORKER_REVISION=100"
```

### C. Secret Rotation / Emergency Credential Revocation

If `SESSION_SECRET`, `SIGNED_TOKEN_SECRET`, or an R2/OAuth secret is suspected compromised:
1. Add a new version in Google Secret Manager (`gcloud secrets versions add ...`).
2. Deploy a new Cloud Run revision referencing `latest` (invalidates all previously signed download tokens immediately).
3. For compromised user/admin accounts, revoke all sessions via Admin Control Centre (`POST /api/v1/admin/users/:publicUserId/revoke-sessions`) or SQL (`UPDATE user_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL`).

### D. Database Migration Rollback Policy

- All migrations under `infra/migrations/` are designed to be **additive and backward-compatible** (`CREATE TABLE IF NOT EXISTS`, nullable columns).
- **Never** run destructive `DROP TABLE` rollbacks on production data; instead, roll back the API container revision to the previous compatible version while preserving the database state, or restore from a point-in-time backup snapshot (Supabase PITR / Cloud SQL automated backup) if data corruption occurred.

---

## 3. Post-Rollback Verification

1. `curl -fsS https://api.muxaro.app/api/v1/health` -> `200 HEALTHY`.
2. `curl -fsS https://api.muxaro.app/api/v1/ready` -> `200`.
3. Verify `/admin/security-events` and `/admin/audit-logs` capture the incident timeline cleanly.
4. Record root cause and preventive action items before re-attempting rollout.
