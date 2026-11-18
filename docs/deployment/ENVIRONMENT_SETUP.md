# MUXARO Environment & Secret Management Setup Guide

**Template:** `.env.example`  
**Git Protection:** `.gitignore` (excludes `.env`, `.env.*`, `.muxaro-data/`, `.muxaro-artifacts/`, `.muxaro-uploads/`, `*.pem`, `*.key`, `apps/web/out/`)  
**Invariant:** ZERO real secrets are ever committed to Git or baked into client bundles.

---

## 1. Separation of Public vs. Secret Configuration

### A. Frontend Public Variables (Cloudflare Pages Build Environment)

Only `NEXT_PUBLIC_*` variables are exposed to browser JavaScript. They must **never** hold secrets.

| Variable | Production Value | Required | Notes |
|---|---|---|---|
| `CLOUDFLARE_PAGES` | `1` | Yes (CF Pages build) | Enables static export (`apps/web/out/`) |
| `NEXT_PUBLIC_SITE_URL` | `https://muxaro.app` | Yes | Canonical URL, OpenGraph, `robots.txt`, `sitemap.xml` |
| `NEXT_PUBLIC_API_URL` | `https://api.muxaro.app` | Yes | Public API origin (never `localhost` in prod) |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | *(unset or real `G-...`)* | Optional | GA4 stays cleanly no-op until configured; Consent Mode v2 defaults to `denied` |
| `NEXT_PUBLIC_GTM_CONTAINER_ID` | *(unset or real `GTM-...`)* | Optional | Optional GTM container |

### B. API Cryptographic & Identity Secrets (Google Secret Manager ONLY)

Generate each cryptographic secret with at least 256 bits of CSPRNG entropy (`openssl rand -hex 32`):

| Secret Name in GCP Secret Manager | Env Var in Cloud Run | Purpose |
|---|---|---|
| `muxaro-session-secret` | `SESSION_SECRET` | HMAC key for bucket hashing, OAuth state binding, and session derivation |
| `muxaro-signed-token-secret` | `SIGNED_TOKEN_SECRET` | HMAC-SHA256 signing key for short-lived artifact download tokens |
| `muxaro-mfa-encryption-key` | `MFA_ENCRYPTION_KEY` | AES-256-GCM key encrypting Admin TOTP secrets at rest in `user_mfa` |
| `muxaro-database-url` | `DATABASE_URL` | PostgreSQL connection URI (Supabase pooler or Cloud SQL) |
| `muxaro-r2-account-id` | `R2_ACCOUNT_ID` | Cloudflare account ID for R2 S3 endpoint |
| `muxaro-r2-access-key-id` | `R2_ACCESS_KEY_ID` | Scoped R2 API token access key (single bucket `muxaro-media`) |
| `muxaro-r2-secret-access-key` | `R2_SECRET_ACCESS_KEY` | Scoped R2 API token secret key for AWS SigV4 signing |
| `muxaro-r2-bucket-name` | `R2_BUCKET_NAME` | Target R2 bucket name (e.g., `muxaro-media`) |
| `muxaro-google-client-id` | `GOOGLE_CLIENT_ID` | Optional Google OAuth 2.0 Web Client ID (`openid email profile` only) |
| `muxaro-google-client-secret` | `GOOGLE_CLIENT_SECRET` | Optional Google OAuth 2.0 Client Secret |
| `muxaro-admin-email` | `MUXARO_ADMIN_EMAIL` | Comma-separated allowlist for initial Admin role promotion (still requires TOTP MFA!) |

---

## 2. Creating Secrets in Google Secret Manager

```bash
export GCP_PROJECT_ID="your-gcp-project-id"

create_secret() {
  local name="$1"
  local value="$2"
  gcloud secrets create "$name" --replication-policy="automatic" --project="$GCP_PROJECT_ID" 2>/dev/null || true
  printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project="$GCP_PROJECT_ID"
}

create_secret "muxaro-session-secret" "$(openssl rand -hex 32)"
create_secret "muxaro-signed-token-secret" "$(openssl rand -hex 32)"
create_secret "muxaro-mfa-encryption-key" "$(openssl rand -hex 32)"
# Add database, R2, OAuth, and admin email secrets interactively without storing in shell history:
# read -rs DATABASE_URL && create_secret "muxaro-database-url" "$DATABASE_URL"
```

---

## 3. GitHub Actions Repository Secrets & Protected Environments

Configure in GitHub -> **Settings -> Secrets and variables -> Actions** and **Environments (`staging`, `production`)**:

| GitHub Secret | Scope | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Staging + Production | Least-privilege token: Cloudflare Pages Edit ONLY |
| `CLOUDFLARE_ACCOUNT_ID` | Staging + Production | Target Cloudflare account ID |
| `GCP_PROJECT_ID` | Production | Google Cloud project ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Production | OIDC Workload Identity Provider (no static JSON service-account keys!) |
| `GCP_SERVICE_ACCOUNT` | Production | Deployer SA email allowed to push Artifact Registry images & replace Cloud Run services |

**Mandatory Environment Protection Rule:** Enable **Required reviewers** on the GitHub `production` environment so `.github/workflows/ci-deploy.yml` pauses for explicit human approval before touching production Cloudflare Pages or Cloud Run.
