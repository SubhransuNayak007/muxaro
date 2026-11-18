# MUXARO DNS Configuration Guide (`muxaro.app`)
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  

---

## 1. Authoritative Cloudflare DNS Record Matrix

Configure these records in the Cloudflare DNS dashboard for zone **`muxaro.app`** after domain registration and Cloudflare Pages / Cloud Run domain mapping:

| Type | Name | Target / Value | Proxy Status | TTL | Purpose |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `CNAME` | `@` (`muxaro.app`) | `muxaro.pages.dev` *(auto-created via Pages Custom Domain)* | **Proxied** (Orange Cloud) | Auto | Apex production web app via Cloudflare CNAME Flattening |
| `CNAME` | `www` (`www.muxaro.app`) | `muxaro.pages.dev` | **Proxied** (Orange Cloud) | Auto | Permanent `301` redirect to `https://muxaro.app/:splat` (via `_redirects` / Cloudflare Redirect Rule) |
| `CNAME` | `api` (`api.muxaro.app`) | `ghs.googlehosted.com.` *(from Cloud Run Domain Mapping)* | **DNS Only** during initial cert issuance → **Proxied** after Active | Auto | Fastify API Gateway (`muxaro-api` on Google Cloud Run) |
| `TXT` | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:security@muxaro.app` | DNS Only | Auto | Email anti-spoofing policy *(preserve/extend if transactional SMTP added)* |
| `TXT` | `@` | `v=spf1 -all` *(or SMTP provider SPF include once `SMTP_HOST` configured)* | DNS Only | Auto | Sender Policy Framework |

---

## 2. Record Preservation & Change Safety Rules

1. **Preserve Existing / Unrelated Records:** Never purge existing `MX`, `SPF`, `DKIM`, `DMARC`, Google Search Console verification `TXT`, or third-party ownership `TXT` records during deployment updates.
2. **Cloud Run Certificate Verification Window:** When first attaching `api.muxaro.app` to Google Cloud Run Domain Mapping, keep the `api` CNAME set to **DNS Only (Grey Cloud)** until Google issues the managed TLS certificate (~10–20 minutes). Once active, switch to **Proxied (Orange Cloud)** with Cloudflare SSL/TLS mode set to **Full (Strict)**.
3. **Zero Public Worker DNS:** `muxaro-worker` is internal-only and MUST NOT receive a public DNS record.

---

## 3. Verification Commands (Post-Provisioning)

```bash
dig +short CNAME muxaro.app
dig +short CNAME api.muxaro.app
curl -I https://www.muxaro.app/   # Expect HTTP/2 301 -> https://muxaro.app/
curl -s https://api.muxaro.app/api/v1/health
```
