# MUXARO Custom Domain & DNS Setup (`muxaro.app`)

**Canonical Web Origin:** `https://muxaro.app`  
**Canonical API Origin:** `https://api.muxaro.app`  
**Internal Worker:** No public DNS record (internal Cloud Run ingress only)  
**Provisioning Status:** DNS configuration documented and ready; live domain registration and DNS cutover have **not** been executed yet.

---

## 1. Authoritative DNS Record Matrix (Cloudflare)

After registering `muxaro.app` and delegating its nameservers to Cloudflare, configure the following records:

| Type | Host / Name | Target / Value | Proxy Status | TTL | Purpose |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `CNAME` | `@` (`muxaro.app`) | `muxaro.pages.dev` *(auto-provisioned by Cloudflare Pages Custom Domain)* | Proxied (Orange Cloud) | Auto | Apex web application (Cloudflare CNAME flattening) |
| `CNAME` | `www` (`www.muxaro.app`) | `muxaro.pages.dev` | Proxied (Orange Cloud) | Auto | Permanent `301` redirect to `https://muxaro.app/:splat` |
| `CNAME` | `api` (`api.muxaro.app`) | `ghs.googlehosted.com.` *(or region target given by Cloud Run Domain Mapping)* | **DNS Only** during initial TLS issuance → **Proxied** once active | Auto | Fastify API Gateway (`muxaro-api` on Cloud Run) |
| `TXT` | `@` | `v=spf1 -all` *(update with SMTP provider SPF when `SMTP_HOST` is configured)* | DNS Only | Auto | Prevent email spoofing on apex domain |
| `TXT` | `_dmarc` | `v=DMARC1; p=quarantine;` *(add `rua=` once monitoring mailbox exists)* | DNS Only | Auto | Domain-based Message Authentication |

> **Critical Rule — Never Expose `muxaro-worker`:** The internal FFmpeg worker (`muxaro-worker`) must **never** receive a public DNS record or public Cloud Run ingress.

---

## 2. Step-by-Step Domain Attachment

### 2.1 Attach `muxaro.app` & `www.muxaro.app` to Cloudflare Pages
1. Open **Cloudflare Dashboard → Workers & Pages → `muxaro` → Custom domains**.
2. Click **Set up a custom domain**, enter `muxaro.app`, and let Cloudflare create the flattened `CNAME` record and issue the edge certificate.
3. Repeat for `www.muxaro.app` so `_redirects` (`apps/web/public/_redirects`) serves `301` redirects to `https://muxaro.app/:splat` over valid HTTPS.

### 2.2 Attach `api.muxaro.app` to Google Cloud Run (`muxaro-api`)
1. Verify domain ownership of `muxaro.app` in Google Cloud / Search Console via DNS `TXT` record.
2. Create the Cloud Run domain mapping:
   ```bash
   gcloud beta run domain-mappings create \
     --service=muxaro-api \
     --domain=api.muxaro.app \
     --region=us-central1 \
     --project="$GCP_PROJECT_ID"
   ```
3. Add the returned `CNAME` (`ghs.googlehosted.com.`) in Cloudflare DNS with Proxy set to **DNS Only (Grey Cloud)** initially so Google's ACME HTTP/DNS validation can issue the origin TLS certificate cleanly.
4. Once `gcloud beta run domain-mappings describe --domain=api.muxaro.app --region=us-central1` shows `CertificateProvisioned: True`, switch the Cloudflare record to **Proxied (Orange Cloud)** under **Full (Strict)** TLS mode.

### 2.3 Cross-Subdomain Cookie & CORS Alignment
Verify these API environment variables match the custom domains in `infra/cloudrun/api-service.yaml`:
- `CORS_ORIGIN=https://muxaro.app`
- `SITE_URL=https://muxaro.app`
- `FRONTEND_URL=https://muxaro.app`
- `BASE_URL=https://api.muxaro.app`
- `GOOGLE_REDIRECT_URI=https://api.muxaro.app/api/v1/auth/google/callback`
- `TRUST_PROXY=true`

> **Cookie Scope Reminder:** Because `apps/api/src/middleware/auth.middleware.ts` currently sets host-only cookies (no `Domain` attribute), either route `/api/v1/*` through a same-origin Cloudflare proxy under `https://muxaro.app/api/v1/*` OR update `serializeCookie()` to emit `Domain=.muxaro.app` when deploying `muxaro.app` and `api.muxaro.app` as separate origins.

---

## 3. Record Preservation & Verification

Never delete existing `MX`, `SPF`, `DKIM`, `DMARC`, or domain ownership verification `TXT` records during updates. After provisioning, verify resolution:

```bash
dig +short CNAME muxaro.app
dig +short CNAME api.muxaro.app
curl -sI https://www.muxaro.app/      # Expect HTTP/2 301 -> https://muxaro.app/
curl -fsS https://api.muxaro.app/api/v1/health
```
