# Security Policy

## Supported Versions

MUXARO active development and security patches ship on the `main` branch across `apps/web`, `apps/desktop`, `apps/mobile`, `apps/api`, `apps/media-worker`, `packages/*`, and `security/`.

| Target | Security Support |
| :--- | :--- |
| `main` (`v2.x` Unified Web, Desktop & Android) | Supported (active) |

---

## Security & Privacy Architecture

1. **On-Device Execution by Default:** PDF manipulation, OCR, PII detection/burn-in redaction, semantic intent routing, and local voice capture run offline without uploading user files. Outbound BYOK cloud calls automatically mask detected personal details before leaving the device.
2. **SSRF & URL Validation (`security/src/ssrf-guard.ts`, `apps/web/lib/security/`):** Restricts schemes to `http:`, `https:`, and `blob:`, and blocks loopback (`127.0.0.0/8`, `::1`), RFC 1918 private networks, link-local / cloud metadata endpoints (`169.254.169.254`), and `.local` / `.internal` hostnames.
3. **Subprocess Isolation (`shell: false`):** All external binaries (`ffmpeg`, `ffprobe`, `yt-dlp`, `whisper-cli`, `piper`) run strictly via `execFile` / `spawn` argument arrays with `shell: false`, sanitized filenames, and strict allowlists.
4. **Electron & Browser Hardening:** Context isolation (`contextIsolation: true`, `nodeIntegration: false`), strict local-origin permission checks (`127.0.0.1`), COOP/COEP headers on `/tools/*`, and `Permissions-Policy` scoped to explicit self permissions.
5. **Cryptographic Hygiene:** Session IDs, LAN pairing PINs, and signed tokens use CSPRNG (`crypto.randomUUID` / `crypto.getRandomValues` / `HMAC-SHA256`).

---

## Reporting a Vulnerability

**Do not open a public GitHub issue or pull request for security vulnerabilities.**

Please submit a private report via GitHub Security Advisories:
- **Advisory Portal:** [github.com/SubhransuNayak007/muxaro/security/advisories/new](https://github.com/SubhransuNayak007/muxaro/security/advisories/new)

Target triage SLA: initial acknowledgment within 48 hours and severity assessment within 5 business days.
