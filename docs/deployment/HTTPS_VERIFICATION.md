# MUXARO HTTPS, TLS & Cookie Security Verification Guide
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  

---

## 1. TLS & Origin Encryption Policy

| Layer | Mandatory Setting | Rationale |
| :--- | :--- | :--- |
| **Cloudflare SSL/TLS Mode** | **Full (Strict)** | Validates Google Cloud Run's origin certificate end-to-end; blocks MITM downgrade attacks (`Flexible` and `Full` non-strict are forbidden). |
| **Minimum TLS Version** | **TLS 1.2** (TLS 1.3 enabled) | Disables legacy TLS 1.0/1.1 ciphers. |
| **Always Use HTTPS** | **Enabled** | Redirects any plaintext request to HTTPS (`301`). Required natively by `.app` HSTS preload. |
| **Automatic HTTPS Rewrites** | **Enabled** | Prevents accidental mixed-content asset references. |
| **Canonical Origin Enforcement** | `https://muxaro.app` | `www.muxaro.app` permanently redirects `301` → `https://muxaro.app/:splat`. |

---

## 2. Production Cookie & SameSite Contract

When `NODE_ENV=production`, `apps/api/src/middleware/auth.middleware.ts` enforces:
- **`muxaro_session`**: `HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.muxaro.app` (shared cleanly between `https://muxaro.app` and `https://api.muxaro.app`, inaccessible to JavaScript).
- **`muxaro_csrf`**: `Secure; SameSite=Lax; Path=/; Domain=.muxaro.app` (readable by `api-client.ts` to echo into `x-muxaro-csrf` header on all `POST`/`PUT`/`PATCH`/`DELETE` requests).
- **CORS (`apps/api/src/app.ts`)**: `CORS_ORIGIN=https://muxaro.app` with `credentials: true` and `TRUST_PROXY=true` so Fastify sees `X-Forwarded-Proto: https` accurately.

---

## 3. Deferred Custom HSTS Policy

- Because `.app` is already preloaded in browser HSTS lists, browsers enforce HTTPS automatically.
- **Do NOT immediately enable `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`** in Cloudflare until all subdomains (`muxaro.app`, `www.muxaro.app`, `api.muxaro.app`) have verified valid origin certificates for at least 7 days. Start conservatively with `max-age=300` during initial smoke testing, then graduate to `max-age=15552000`.

---

## 4. Post-Launch Verification Checklist

- [ ] `curl -sI https://muxaro.app` returns `HTTP/2 200` with `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- [ ] `curl -sI https://www.muxaro.app/tools` returns `301` → `https://muxaro.app/tools`.
- [ ] `curl -sI https://api.muxaro.app/api/v1/health` returns `HTTP/2 200` over TLS 1.3.
- [ ] Authenticated login from `https://muxaro.app/login` sets `muxaro_session` with `HttpOnly; Secure; SameSite=Lax` and persists across refresh.
