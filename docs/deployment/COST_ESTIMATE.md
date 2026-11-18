# MUXARO Production Cost Estimate & Financial Guardrails
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  

---

## 1. Monthly & Annual Cost Breakdown (Launch Topology)

All figures below are honest estimates based on published free-tier allowances and usage-based pricing as of November 2026 (subject to live vendor checkout/pricing):

| Component | Platform | Tier / Sizing | Estimated Fixed Cost | Usage-Based / Scaling Cost |
| :--- | :--- | :--- | ---: | :--- |
| **Domain (`muxaro.app`)** | Cloudflare Registrar | Paid `.app` TLD (requires explicit owner approval) | **~$8.20 yr 1** / **~$14.20/yr renewal** (~$0.68–$1.18/mo) | Fixed annual ICANN registration |
| **Frontend Hosting (`muxaro-web`)** | Cloudflare Pages | Free Plan (Static export `out/`) | **$0.00 / mo** | Unlimited static bandwidth; 500 builds/mo free |
| **DNS, WAF & TLS** | Cloudflare | Free Plan | **$0.00 / mo** | Unlimited DNS queries & DDoS protection |
| **Object Storage (`muxaro-storage`)** | Cloudflare R2 | Free Allowance (10 GB storage, 1M Class A, 10M Class B ops/mo, **$0 egress**) | **$0.00 / mo** | $0.015/GB-mo above 10 GB (mitigated by 24h lifecycle auto-purge) |
| **Database (`muxaro-db`)** | Supabase Free *(launch)* | 500 MB PostgreSQL *(pauses after 7d inactivity!)* | **$0.00 / mo** | Upgrade to ~$19–$25/mo for always-on non-pausing SLA |
| **API (`muxaro-api`)** | Google Cloud Run | `minScale: 0`, `maxScale: 2`, `1 vCPU / 1 GiB` | **$0.00 idle** | Free tier: 2M requests, 180k vCPU-s, 360k GiB-s/mo; ~$0–$10/mo at light launch load |
| **Media Worker (`muxaro-worker`)** | Google Cloud Run (Internal) | `minScale: 0`, `maxScale: 2`, `2 vCPU / 2 GiB`, timeout `600s` | **$0.00 idle** | Billed strictly per active FFmpeg transcode second; ~$5–$25/mo under moderate video load |
| **Analytics (GA4)** | Google Analytics 4 | Standard Free | **$0.00 / mo** | Free |

**Total Launch Baseline:** **~$8.20 one-time domain registration + $0–$15/month** at low launch traffic (scaling linearly only when active transcoding exceeds Cloud Run free-tier vCPU-seconds).

---

## 2. Hard Cost Guardrails & Billing Alert Disclaimer

1. **Scale-to-Zero & Hard Concurrency Ceilings (`infra/cloudrun/*.yaml`):**
   - Both `muxaro-api` and `muxaro-worker` enforce `autoscaling.knative.dev/minScale: "0"` (zero idle compute billing) and `autoscaling.knative.dev/maxScale: "2"` (prevents runaway container fan-out during traffic spikes or abuse).
   - Cloudflare R2 24-hour lifecycle auto-purge keeps storage well inside the 10 GB free tier and incurs **$0 egress fees**.
2. **IMPORTANT BILLING DISCLAIMER (Budget Alerts Are NOT Hard Caps):**
   > **Google Cloud Billing Budgets & Alerts only send email/PubSub notifications when thresholds (e.g., 50%, 80%, 100%) are crossed — they do NOT automatically stop Cloud Run services or cap spending.**
   - To enforce a real emergency cost stop, operators MUST either run `infra/scripts/emergency-shutdown.sh` (scales Cloud Run services to `maxScale=0` / halts traffic) or connect the GCP Budget Pub/Sub topic to a verified Cloud Function circuit-breaker.
