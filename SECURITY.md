# Security Policy

## Supported Versions

MUXARO is currently in pre-release (`0.1.0` candidate on the `main` branch). Security fixes are applied directly to `main`.

| Version / Branch | Supported |
| :--- | :---: |
| `main` (`0.1.0` pre-release) | Yes |
| Earlier snapshots / unversioned forks | No |

---

## Reporting a Vulnerability (Private Disclosure)

**Please do NOT report security vulnerabilities through public GitHub issues, pull requests, or discussions.**

Instead, please report suspected vulnerabilities privately using **GitHub Private Vulnerability Reporting** on this repository:

- **GitHub Security Advisories:** [`https://github.com/SubhransuNayak007/muxaro/security/advisories/new`](https://github.com/SubhransuNayak007/muxaro/security/advisories/new)

### What to Include in a Report
- Affected component or file path (e.g., `security/src/ssrf-guard.ts`, `apps/api/src/routes/media.ts`, `apps/api/src/middleware/auth.middleware.ts`)
- Step-by-step reproduction instructions or a minimal proof-of-concept payload
- Observed impact and any suggested remediation

### Response Expectations
- Maintainer acknowledgement goal: within **72 hours**
- Triage and remediation timeline: prioritized by severity (SSRF, RCE, auth/MFA bypass, and IDOR treated as highest priority)
- Coordinated disclosure: we request reasonable time to patch and verify a fix before public disclosure, and will credit reporters who wish to be acknowledged.

---

## Implemented Security Controls

MUXARO implements defense-in-depth engineering controls across the codebase (documented in detail under [`docs/security/`](./docs/security/THREAT_MODEL.md)):

- **SSRF Defense (`security/src/ssrf-guard.ts`, `packages/source-adapters/src/ssrf-filter.ts`):** Blocks loopback, RFC 1918 private, link-local/cloud IMDS (`169.254.169.254`, `metadata.google.internal`), CGNAT, multicast, IPv6 private/mapped, obfuscated IPs (decimal/hex/octal/abbreviated), restricted ports, embedded credentials, and DNS rebinding via socket IP pinning and redirect re-validation.
- **FFmpeg Command & Path Hardening (`security/src/ffmpeg-sanitizer.ts`, `apps/media-worker/src/process/sanitizer.ts`):** Enforces `{ shell: false }`, `-protocol_whitelist file,crypto,data`, `-nostdin`, codec/preset allowlists, filename sanitization, and `fs.realpathSync()` directory jail checks.
- **Authentication, Sessions & Admin MFA (`apps/api/src/services/auth.service.ts`, `mfa.service.ts`, `middleware/auth.middleware.ts`):** Native Node 24 Argon2id (with Scrypt fallback) password hashing, SHA-256 hashed `HttpOnly` sessions, synchronizer + double-submit CSRF (`x-muxaro-csrf`), Google OAuth 2.0 + PKCE (`S256`) + JWKS RS256 verification, and mandatory AES-256-GCM encrypted RFC 6238 TOTP MFA for all `/api/v1/admin/*` management routes.
- **Authorization & IDOR Protection (`apps/api/src/services/request-identity.ts`, `routes/download.ts`):** Non-sequential Base32 IDs (`MXR-*`, `MXB-*`, `MXJ-*`), strict `isOwnerOrAdmin()` ownership checks, and timing-safe HMAC-SHA256 signed download tokens.
- **Abuse Prevention & Log Redaction (`apps/api/src/services/ratelimit.service.ts`):** Multi-layer sliding-window + token-bucket rate limits, progressive login failure backoff (never permanent DoS lockout), duplicate payload flood detection, ECDSA-SHA256 server-side rewarded-ad verification, and recursive secret/PII/URL redaction.
- **Container Isolation (`infra/Dockerfile.api`, `infra/Dockerfile.worker`, `infra/cloudrun/worker-service.yaml`):** Non-root UID `10001`, `/usr/bin/tini` PID 1, `internal`-only Cloud Run worker ingress, and Google Secret Manager injection.

> **Compliance & Certification Disclaimer:** MUXARO is an open-source software project with internal automated security tests and QA verification harnesses. It does **not** claim SOC 2, ISO 27001, PCI-DSS, HIPAA, or external third-party penetration test certifications. Operators deploying MUXARO are responsible for their own cloud IAM, TLS, database, and compliance posture.

---

## Security Documentation

- [Threat Model (STRIDE)](./docs/security/THREAT_MODEL.md)
- [Authentication Architecture](./docs/security/AUTHENTICATION.md)
- [Authorization & IDOR Defense](./docs/security/AUTHORIZATION.md)
- [Upload & FFmpeg Execution Security](./docs/security/UPLOAD_SECURITY.md)
- [SSRF Prevention](./docs/security/SSRF_PREVENTION.md)
- [Secrets Management](./docs/security/SECRETS_MANAGEMENT.md)
- [Abuse Prevention & Rate Limiting](./docs/security/ABUSE_PREVENTION.md)
