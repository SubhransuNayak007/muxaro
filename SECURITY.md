# Security Policy

## Supported Environments &amp; Versions

MUXARO active development and security patches ship on the `main` branch across `apps/web`, `apps/desktop`, `apps/mobile`, `apps/api`, `apps/media-worker`, `packages/*`, and `security/`.

| Target | Deployment | Security Status |
| :--- | :--- | :--- |
| **MUXARO Web** | [muxaro.vercel.app](https://muxaro.vercel.app) | Supported (Continuous active deployment) |
| **MUXARO Desktop (.exe)** | Windows x64 Portable (`v2.x`) | Supported (active) |
| **MUXARO Mobile (.apk)** | Android Capacitor (`v2.x`) | Supported (active) |
| **Self-Hosted API** | Fastify 5 + Media Worker | Supported (active) |

---

## Security &amp; Privacy Architecture

1. **On-Device Execution by Default:**
   PDF manipulation, OCR, PII detection/burn-in redaction, semantic intent routing, and local voice capture run completely offline without uploading user files. Outbound BYOK cloud calls automatically mask detected personal details (credit cards, Aadhaar, PAN, SSN, emails, phone numbers) before leaving the device.
2. **Zero Unauthorized Telemetry:**
   No behavioral tracking, cookies, session recording, or third-party analytical scripts run in MUXARO Studio. The production Web deployment on Vercel serves strictly static assets.
3. **SSRF &amp; URL Validation (`security/src/ssrf-guard.ts`, `apps/web/lib/security/`):**
   Restricts schemes strictly to `http:`, `https:`, and `blob:`, and blocks loopback (`127.0.0.0/8`, `::1`), RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local / cloud metadata endpoints (`169.254.169.254`), and `.local` / `.internal` hostnames.
4. **Subprocess Isolation (`shell: false`):**
   All external binaries (`ffmpeg`, `ffprobe`, `yt-dlp`, `whisper-cli`, `piper`) execute strictly via `execFile` / `spawn` argument arrays with `shell: false`, sanitized filenames, and strict binary path allowlists.
5. **Electron &amp; Browser Hardening:**
   Context isolation (`contextIsolation: true`, `nodeIntegration: false`), strict local-origin permission checks (`127.0.0.1`), COOP/COEP headers on `/tools/*`, and `Permissions-Policy` scoped to explicit self permissions.
6. **Cryptographic Hygiene:**
   Session IDs, LAN pairing PINs, and signed tokens use CSPRNG (`crypto.randomUUID` / `crypto.getRandomValues` / `HMAC-SHA256`).

---

## Vulnerability Reporting &amp; SLA

**Do not open a public GitHub issue or pull request for security vulnerabilities.**

Please submit a confidential report via GitHub Security Advisories:
- **Advisory Portal:** [github.com/SubhransuNayak007/muxaro/security/advisories/new](https://github.com/SubhransuNayak007/muxaro/security/advisories/new)

### Response Commitments
- **Initial Acknowledgment:** Within 48 hours of report submission.
- **Triage &amp; Severity Assessment:** Within 5 business days.
- **Remediation &amp; Disclosure:** Coordinated release with CVE assignment where applicable.
