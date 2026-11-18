# MUXARO Deployment Security Verification & Hardening Checklist

**Owner:** Workstream 4 / Deployment Phase B2 (`secops`)  
**Related Specs:** `docs/security/RATE_LIMITING_ARCHITECTURE.md`, `docs/security/ABUSE_PREVENTION.md`, `docs/account-platform/SECURITY_TEST_REPORT.md`

---

## 1. Verified Pre-Deployment Security Controls (Local & Static Audit)

| Domain | Control | Implementation Artifact | Verification Status |
|---|---|---|---|
| **Container Isolation** | Non-root UID `10001`, `/usr/sbin/nologin`, `tini` PID 1, mode `0700` `/tmp` scratch | `infra/Dockerfile.api`, `infra/Dockerfile.worker` | **VERIFIED IN MANIFEST** |
| **Worker Network Isolation** | Media worker restricted to `run.googleapis.com/ingress: internal`; never `allUsers` | `infra/cloudrun/worker-service.yaml` | **VERIFIED IN MANIFEST** |
| **Zero Committed Secrets** | `.gitignore` blocks `.env*`, `*.pem`, `*.key`, `*.db`, `.muxaro-*`; CI scans for OAuth/PEM leaks | `.gitignore`, `.env.example`, `.github/workflows/ci-deploy.yml` | **VERIFIED** |
| **Secret Manager Injection** | All API & worker credentials loaded strictly via `secretKeyRef` (`latest`), zero literal secrets in YAML | `infra/cloudrun/api-service.yaml`, `infra/cloudrun/worker-service.yaml` | **VERIFIED IN MANIFEST** |
| **Workload Identity (OIDC)** | GitHub Actions authenticates to GCP via `google-github-actions/auth@v2` WIF (zero static JSON keys) | `.github/workflows/ci-deploy.yml` | **VERIFIED IN WORKFLOW** |
| **CORS & Cookie Hygiene** | `credentials: true`, exact origin allowlist (`https://muxaro.app`), `HttpOnly; SameSite=Lax; Secure` in prod, `x-muxaro-csrf` | `apps/api/src/app.ts`, `apps/api/src/middleware/auth.middleware.ts` | **VERIFIED (SEC-01, SEC-05)** |
| **Admin TOTP MFA Gate** | Every `/api/v1/admin/*` control endpoint requires `role === 'admin'` + verified RFC 6238 TOTP + CSRF + immutable audit log | `apps/api/src/routes/admin.ts`, `apps/api/src/services/admin.service.ts` | **VERIFIED (SEC-04, SEC-05, SEC-06)** |
| **Multi-Layer Rate Limiting** | Separate from daily quotas; sliding-window + token-bucket; job/batch polling exempted; `429 + Retry-After` with zero risk-score leaks | `apps/api/src/services/ratelimit.service.ts`, `apps/api/src/app.ts` | **VERIFIED (SEC-07, SEC-08)** |
| **Redacted Security Telemetry** | Passwords, tokens, cookies, CSRF secrets, emails, and private URLs scrubbed; IPv4->`/24`, IPv6->`/48` | `apps/api/src/services/ratelimit.service.ts` | **VERIFIED (SEC-09)** |
| **SSRF & Cross-Account IDOR** | Private IP/metadata CIDR blocking (`403 SSRF_BLOCKED`); strict owner checks (`403 ERR_FORBIDDEN`) across jobs/batches/downloads/sessions/rewards | `security/src/ssrf-guard.ts`, `apps/api/src/services/request-identity.ts` | **VERIFIED (14/14 + 9/9 PASS)** |
| **Billing / DoS Guardrails** | `minScale: "0"`, `maxScale: "2"`, bounded CPU/RAM, emergency halt script | `infra/cloudrun/*.yaml`, `infra/scripts/emergency-shutdown.sh` | **VERIFIED** |

---

## 2. Mandatory Post-Deploy Production Security Checks (Execute After Go-Live)

Once `https://muxaro.app` and `https://api.muxaro.app` are live, execute and record each verification:

1. **TLS & Edge Headers**:
   - Confirm Cloudflare SSL mode is **Full (Strict)** with valid TLS 1.3 certificate on both `muxaro.app` and `api.muxaro.app`.
   - Confirm `curl -fsSI https://muxaro.app/` returns `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`.
2. **Private Route Non-Indexability**:
   - Confirm `https://muxaro.app/robots.txt` disallows `/admin`, `/account`, `/dashboard`, `/credits`, `/login`, `/register`, `/verify-email`, `/reset-password`.
   - Confirm those routes emit both `X-Robots-Tag: noindex, nofollow` and `<meta name="robots" content="noindex, nofollow">`.
3. **Worker Non-Reachability**:
   - Confirm the Cloud Run `muxaro-worker` URL rejects unauthenticated internet probes (`403`/`404`).
4. **Admin MFA Enforcement**:
   - Confirm `GET https://api.muxaro.app/api/v1/admin/users` returns `401` unauthenticated, `403` for non-admin, `403` for admin without TOTP, and `200` only after RFC 6238 TOTP verification.
5. **Cookie Security Flags in Production**:
   - Confirm `POST https://api.muxaro.app/api/v1/auth/login` sets `muxaro_session` with `HttpOnly; Secure; SameSite=Lax`.
6. **Zero Localhost Leaks**:
   - Confirm `apps/web/out/` and live HTML/JS chunks contain zero references to `localhost:3000`, `localhost:4000`, or `127.0.0.1`.
