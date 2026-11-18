# MUXARO Domain Configuration & Registrar Audit (`muxaro.app`)
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  

---

## 1. Live Availability Verification (Empirical Evidence)

Checked directly against the authoritative Google Registry RDAP endpoint and DNS resolvers on **18 November 2026**:

| Check | Endpoint / Method | Verified Result | Status |
| :--- | :--- | :--- | :---: |
| **Google Registry RDAP** | `GET https://pubapi.registry.google/rdap/domain/muxaro.app` | **HTTP `404 Not Found`** (domain is NOT registered) | **AVAILABLE** |
| **Authoritative DNS Lookup** | `muxaro.app` (`A` / `AAAA` / `NS`) | **`NXDOMAIN`** (no active zone or nameservers) | **AVAILABLE** |

---

## 2. Registrar Selection & Pricing Transparency

- **Recommended Registrar:** **Cloudflare Registrar** (at-cost wholesale ICANN pricing, zero renewal markup, native Cloudflare DNS & Pages integration, free WHOIS privacy).
- **Estimated `.app` Pricing (Cloudflare Registrar):**
  - First-year promotional rate: **~$8.20 USD** *(subject to live checkout verification at purchase time)*
  - Standard annual renewal rate: **~$14.20 USD / year** *(subject to Google Registry wholesale schedule)*

---

## 3. Mandatory User Approval Gate (No Autonomous Purchase)

> **HARD FINANCIAL GATE:** Domain registration is a **paid external financial transaction**. Automated agents MUST NOT purchase `muxaro.app` or enter payment credentials autonomously.
>
> **Owner Action Required:**
> 1. Sign in to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Domain Registration → Register Domains**.
> 2. Search `muxaro.app`, verify live checkout price, and complete registration with auto-renew configured as desired.
> 3. Confirm `muxaro.app` appears as **Active** in your Cloudflare Zone list before binding custom domains in Cloudflare Pages and Cloud Run.

---

## 4. `.app` TLD Mandatory HTTPS Preload Requirement

`.app` is an **HSTS-preloaded Top-Level Domain** baked directly into Chrome, Firefox, Safari, and Edge:
- Plain HTTP (`http://muxaro.app`, `http://api.muxaro.app`) is **refused by browsers** — valid TLS certificates are mandatory for every subdomain from minute one.
- **Verification Checklist Post-Registration:**
  - Confirm Cloudflare Universal SSL edge certificate is **Active** for `muxaro.app` and `*.muxaro.app`.
  - Confirm `https://muxaro.app` serves HTTP `200` and `https://www.muxaro.app` returns `301` → `https://muxaro.app`.
  - Confirm `https://api.muxaro.app/api/v1/health` resolves over TLS 1.3 with valid certificate chain.
