# MUXARO Rollback & Emergency Incident Runbook

**Emergency Shutdown Script:** `infra/scripts/emergency-shutdown.sh`  
**Scope:** Cloudflare Pages (`muxaro`), Google Cloud Run (`muxaro-api`, `muxaro-worker`), Google Secret Manager, PostgreSQL / SQLite Database.

---

## 1. Emergency Traffic Halt (< 60 Seconds)

During an active DDoS/abuse wave, billing spike, or critical security incident, execute `infra/scripts/emergency-shutdown.sh` to restrict `muxaro-api` to `internal` ingress and cap scaling (`minScale=0`, `maxScale=1`):

```bash
# 1. Always preview commands first (dry run)
GCP_PROJECT_ID="your-gcp-project-id" GCP_REGION="us-central1" \
  ./infra/scripts/emergency-shutdown.sh --dry-run

# 2. Execute emergency traffic halt
GCP_PROJECT_ID="your-gcp-project-id" GCP_REGION="us-central1" \
  ./infra/scripts/emergency-shutdown.sh

# 3. Optional: also strip public allUsers invoker + enable Cloudflare Under Attack shield
GCP_PROJECT_ID="your-gcp-project-id" GCP_REGION="us-central1" \
  CLOUDFLARE_ZONE_ID="..." CLOUDFLARE_API_TOKEN="..." \
  ./infra/scripts/emergency-shutdown.sh --revoke-public
```

To restore normal bounded traffic (`min=0, max=2`, API `ingress=all`, worker `ingress=internal`, Cloudflare security level `medium`) after mitigation:

```bash
GCP_PROJECT_ID="your-gcp-project-id" GCP_REGION="us-central1" \
  ./infra/scripts/emergency-shutdown.sh --restore
```

---

## 2. Layer-by-Layer Rollback Procedures

### 2.1 Frontend Rollback (Cloudflare Pages — ~10 Seconds)
Every Cloudflare Pages deployment is immutable:
1. Open **Cloudflare Dashboard → Workers & Pages → `muxaro` → Deployments**.
2. Locate the previous verified production deployment.
3. Click **`...` → Rollback to this deployment**.
4. Confirm `curl -sI https://muxaro.app/` returns `HTTP/2 200` and browser DevTools reports zero console errors.

### 2.2 API & Media Worker Rollback (Google Cloud Run — ~15 Seconds)
Cloud Run retains immutable revision history automatically:

```bash
export GCP_PROJECT_ID="your-gcp-project-id"
export GCP_REGION="us-central1"

# List recent API revisions
gcloud run revisions list --service=muxaro-api --region="$GCP_REGION" --project="$GCP_PROJECT_ID" --limit=5

# Shift 100% traffic immediately to the last known-good revision
gcloud run services update-traffic muxaro-api \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --to-revisions="<LAST_HEALTHY_REVISION>=100"

# Repeat for muxaro-worker if the regression is in media processing
gcloud run revisions list --service=muxaro-worker --region="$GCP_REGION" --project="$GCP_PROJECT_ID" --limit=5
gcloud run services update-traffic muxaro-worker \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --to-revisions="<LAST_HEALTHY_WORKER_REVISION>=100"
```

### 2.3 Secret Compromise Rollback & Session Revocation
1. Add a fresh secret version in Google Secret Manager (`gcloud secrets versions add <secret-name> --data-file=-`).
2. Deploy a new Cloud Run revision picking up `latest`.
3. Revoke compromised user sessions via Admin Control Centre (`POST /api/v1/admin/users/:publicUserId/revoke-sessions`) or revoke all sessions directly in the database (`UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL`).

### 2.4 Database Rollback Policy
- Because `infra/migrations/` follows additive, backward-compatible DDL (`CREATE TABLE IF NOT EXISTS`), **do not** run destructive `DROP TABLE` rollbacks on production data.
- Roll back the Cloud Run application container revision first; if data corruption occurred, restore from a verified database snapshot / Point-in-Time Recovery (PITR).

---

## 3. Post-Rollback Verification Checklist

- [ ] `curl -fsS https://api.muxaro.app/api/v1/health` returns `200` (`status: "HEALTHY"`).
- [ ] `curl -fsS https://api.muxaro.app/api/v1/ready` returns `200` (`status: "READY"`).
- [ ] `https://muxaro.app/` loads cleanly with zero mixed-content or CORS errors.
- [ ] Review `/api/v1/admin/security-events` and `/api/v1/admin/audit-logs` to document timeline and root cause before scheduling a re-deploy.
