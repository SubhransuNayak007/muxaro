# MUXARO Secrets Management Guide

**Configuration Template:** `.env.example`  
**Runtime Config Validator:** `apps/api/src/config.ts` (`validateProductionConfig`)  
**Production Secret Injection:** `infra/cloudrun/api-service.yaml`, `infra/cloudrun/worker-service.yaml` (Google Secret Manager `secretKeyRef`)

---

## 1. Core Security Invariants

1. **Zero Committed Secrets:** `.env`, `.env.*`, private keys (`*.pem`, `*.key`), and runtime data directories (`.muxaro-data/`, `.muxaro-artifacts/`, `.muxaro-uploads/`) are excluded via `.gitignore`. Only sanitized placeholder templates exist in `.env.example`.
2. **Strict Public vs. Private Boundary:** Only `NEXT_PUBLIC_*` variables (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, optional `NEXT_PUBLIC_GA_MEASUREMENT_ID`, optional `NEXT_PUBLIC_GTM_CONTAINER_ID`) are ever exposed to `apps/web` browser bundles. Cryptographic keys, database URIs, R2 keys, OAuth secrets, and SMTP passwords live **exclusively** on the server.
3. **Fail-Safe Production Validation (`apps/api/src/config.ts`):** When `NODE_ENV=production`, `validateProductionConfig()` rejects:
   - Default development `SESSION_SECRET` or `SIGNED_TOKEN_SECRET`, or any secret shorter than 32 characters.
   - Any `API_BASE_URL` / `SITE_URL` referencing `localhost`.
   - Emits warnings for wildcard `CORS_ORIGIN`, partial `R2_*` configs, or unconfigured R2 storage—without ever printing secret values.
4. **Zero Secret Leakage in Telemetry:** `redactSensitiveData()` in `apps/api/src/services/ratelimit.service.ts` scrubs keys matching `password`, `token`, `secret`, `auth`, `cookie`, `csrf`, `api_key`, `signature`, `jwt`, `session_id`, `code_verifier`, `backup_codes`, `private`, and `credential` before writing logs or `security_events`.

---

## 2. Secret Inventory & Generation

Generate all symmetric cryptographic secrets with at least 256 bits of CSPRNG entropy (`openssl rand -hex 32`):

| Environment Variable | GCP Secret Manager Name | Required in Prod | Scope | Purpose |
| :--- | :--- | :---: | :--- | :--- |
| `SESSION_SECRET` | `muxaro-session-secret` | Yes | `muxaro-api` | Keyed HMAC bucket hashing, OAuth state binding, fallback MFA key derivation |
| `SIGNED_TOKEN_SECRET` | `muxaro-signed-token-secret` | Yes | `muxaro-api` | HMAC-SHA256 signing key for short-lived download tokens |
| `MFA_ENCRYPTION_KEY` | `muxaro-mfa-encryption-key` | Yes | `muxaro-api` | AES-256-GCM encryption key for Admin TOTP secrets in `user_mfa` |
| `DATABASE_URL` | `muxaro-database-url` | Yes (PG prod) | `muxaro-api` | TLS-enforced (`sslmode=require`) PostgreSQL connection URI |
| `R2_ACCOUNT_ID` | `muxaro-r2-account-id` | Recommended | `api` + `worker` | Cloudflare account identifier |
| `R2_ACCESS_KEY_ID` | `muxaro-r2-access-key-id` | Recommended | `api` + `worker` | Bucket-scoped R2 Object Read/Write access key |
| `R2_SECRET_ACCESS_KEY` | `muxaro-r2-secret-access-key` | Recommended | `api` + `worker` | Bucket-scoped R2 secret key for AWS SigV4 signing |
| `R2_BUCKET_NAME` | `muxaro-r2-bucket-name` | Recommended | `api` + `worker` | Private R2 bucket name (e.g. `muxaro-media`) |
| `GOOGLE_CLIENT_ID` | `muxaro-google-client-id` | Optional | `muxaro-api` | Google OAuth 2.0 Web Client ID (`openid email profile`) |
| `GOOGLE_CLIENT_SECRET` | `muxaro-google-client-secret` | Optional | `muxaro-api` | Google OAuth 2.0 Client Secret |
| `MUXARO_ADMIN_EMAIL` | `muxaro-admin-email` | Optional | `muxaro-api` | Comma-separated email allowlist for initial Admin promotion (TOTP MFA still mandatory) |
| `SMTP_USER` / `SMTP_PASS` | *(optional SM secrets)* | Optional | `muxaro-api` | Transactional SMTP credentials for email verification & password resets |

---

## 3. Cloud Secret Provisioning & IAM Scoping

### 3.1 Google Secret Manager (Cloud Run)
`infra/cloudrun/api-service.yaml` and `infra/cloudrun/worker-service.yaml` mount secrets exclusively via `valueFrom.secretKeyRef` (never literal values in YAML):

- `muxaro-api-sa@PROJECT_ID.iam.gserviceaccount.com`: Granted `roles/secretmanager.secretAccessor` scoped to API secrets.
- `muxaro-worker-sa@PROJECT_ID.iam.gserviceaccount.com`: Granted `roles/secretmanager.secretAccessor` **strictly** for the 4 R2 storage secrets (the worker never receives `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `DATABASE_URL`, or OAuth credentials).

### 3.2 GitHub Actions CI/CD Secrets
- **GCP Authentication:** Uses **OIDC Workload Identity Federation** (`GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT`)—never long-lived static JSON service-account keys.
- **Cloudflare Pages:** Uses a narrowly scoped `CLOUDFLARE_API_TOKEN` limited to Cloudflare Pages Edit only (`CLOUDFLARE_ACCOUNT_ID`).
- **Environment Protection:** Production deployment secrets reside inside a protected GitHub `production` environment requiring manual reviewer approval.

---

## 4. Rotation & Compromise Response

| Compromised Secret | Immediate Action | Impact of Rotation |
| :--- | :--- | :--- |
| **`SIGNED_TOKEN_SECRET`** | Add new version in Google Secret Manager and deploy a new Cloud Run revision | Immediately invalidates all previously issued download tokens; users simply request fresh download links |
| **`SESSION_SECRET`** | Rotate in Secret Manager + deploy new revision; optionally revoke all `user_sessions` | Resets HMAC rate-limit buckets; does not decrypt existing `user_mfa` rows if dedicated `MFA_ENCRYPTION_KEY` is set |
| **`MFA_ENCRYPTION_KEY`** | Decrypt and re-encrypt `user_mfa.secret` rows offline before switching key, or require admins to re-enroll TOTP MFA | Rotating without re-encrypting invalidates existing encrypted TOTP secrets |
| **`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`** | Create new scoped R2 API token, update Secret Manager, deploy revision, then revoke compromised token in Cloudflare R2 | Zero downtime when rotated in create → deploy → revoke order |
| **`GOOGLE_CLIENT_SECRET`** | Rotate secret in Google Cloud Console OAuth Credentials, update Secret Manager, deploy revision | Existing MUXARO sessions remain valid; new OAuth exchanges use the new secret |
