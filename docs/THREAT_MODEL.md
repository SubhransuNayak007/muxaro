# Threat Model: Project MUXARO Media Processing Platform

**Document Version:** 1.0  
**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)  
**Author:** AGENT 08: Cybersecurity Engineer  
**Status:** Engineering Baseline  
**Scope:** Core Web Application (`apps/web`), API Gateway (`apps/api`), Media Worker (`apps/media-worker`), Source Adapters (`packages/source-adapters`), Entitlements & Ledger (`packages/entitlements`), and Security Guard (`security/`).

---

## 1. Executive Summary & Architecture Context

MUXARO is a high-performance, web-based media processing and conversion SaaS platform. The system ingests user-provided URLs and media files, inspects metadata, extracts audio/video streams, converts codecs/containers up to authentic 8K resolutions, and packages batch playlists.

Because the system accepts arbitrary external URLs, downloads media payloads from third-party networks, executes intensive FFmpeg processes, and writes files to local and object storage, **SSRF, command injection, path traversal, resource exhaustion DoS, and unauthorized media extraction constitute critical threat vectors**.

This Threat Model decomposes the architecture, establishes trust boundaries, enumerates threats using STRIDE, and maps each threat to concrete technical controls implemented in `security/` and related services.

---

## 2. System Decomposition & Trust Boundaries

### 2.1 Component Architecture Diagram

```
+-----------------------------------------------------------------------------------+
| UNTRUSTED EXTERNAL ZONE (Public Internet, Malicious Actors, External Media Hosts) |
+-----------------------------------------------------------------------------------+
                                         |
                                  [HTTPS / TLS 1.3]
                                         v
+-----------------------------------------------------------------------------------+
| TRUST BOUNDARY 1: Edge & Ingress (Cloudflare / WAF / Reverse Proxy)                |
| - DDoS mitigation, IP reputation, TLS termination, Rate Limiting                  |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| TRUST BOUNDARY 2: API Gateway Service (apps/api - Fastify Node.js)                |
| - SSRF URL Pre-Validation (security/src/ssrf-guard.ts)                            |
| - Input Schema Sanitization & Prototype Pollution Defense (security/src/validation)|
| - Rate Limiting & Tiered Abuse Prevention (security/src/rate-limiter.ts)          |
| - Authentication & RBAC Session Checks (packages/entitlements)                    |
| - Atomic 24h Quota Reservations (PostgreSQL transactions + Outbox)                |
+-----------------------------------------------------------------------------------+
             |                                    |
     [SQL / TLS]                         [Redis Protocol]
             v                                    v
+-----------------------------+     +-----------------------------------------------+
| TRUST BOUNDARY 3:           |     | TRUST BOUNDARY 4: Distributed Message Queue   |
| PostgreSQL Database         |     | Redis / BullMQ Cluster                        |
| - Users, Quotas, Outbox     |     | - Job state, priority queues, retry counters  |
+-----------------------------+     +-----------------------------------------------+
                                                  |
                                                  v
+-----------------------------------------------------------------------------------+
| TRUST BOUNDARY 5: Media Processing Worker (apps/media-worker)                      |
| - Isolated Container Execution (Non-root user UID 10001, CAP_DROP ALL)            |
| - Safe FFmpeg Argument Builder (security/src/ffmpeg-sanitizer.ts, shell: false)   |
| - Protocol Whitelisting (-protocol_whitelist "file,crypto,data")                  |
| - Scratch Directory Sandbox Enforcement (path canonicalization, symlink checks)   |
| - Output File Verification (FFprobe integrity audit before transitioning READY)    |
+-----------------------------------------------------------------------------------+
             |                                    |
     [SSRF Safe Socket]                  [S3 API / TLS]
             v                                    v
+-----------------------------+     +-----------------------------------------------+
| External Authorized Media   |     | TRUST BOUNDARY 6: Artifact Storage (MinIO/S3) |
| Direct HTTP/S Streams       |     | - Time-limited Presigned Download URLs (15m)  |
| (NO unauthorized extraction)|     | - Ephemeral Retention (24h TTL)               |
+-----------------------------+     +-----------------------------------------------+
```

### 2.2 Trust Boundaries Defined

| Boundary | Interface | Description | Trust Transition |
|---|---|---|---|
| **TB1** | Client -> Edge (WAF) | Ingress from public internet | Untrusted -> Sanitized Edge |
| **TB2** | Edge -> API Gateway | Reverse proxy passing forwarded headers | Filtered Edge -> Trusted App Gateway |
| **TB3** | API -> PostgreSQL | Internal database connection | Trusted App -> High-Trust Data Store |
| **TB4** | API -> Redis Queue | Job enqueuing via BullMQ | Trusted App -> Ephemeral State Store |
| **TB5** | Media Worker -> Network | Fetching remote media streams | Sandboxed Worker -> Untrusted Remote Host |
| **TB6** | Media Worker -> Storage | Writing scratch files & uploading artifacts | Sandboxed Worker -> Secure Storage |
| **TB7** | Client -> S3 Storage | Downloading completed media artifact | Untrusted Client -> Signed Ephemeral URL |

---

## 3. Asset Inventory & Criticality

| Asset ID | Asset Name | Criticality | Impact of Compromise |
|---|---|---|---|
| **A1** | Cloud Metadata & IAM Credentials (`169.254.169.254`) | **CRITICAL** | Full host/cluster compromise via stolen AWS/GCP instance credentials. |
| **A2** | Host Operating System & Container Runtime | **CRITICAL** | Arbitrary code execution, lateral movement, botnet pivot. |
| **A3** | User Identity, Session Tokens, PII | **HIGH** | Account takeover, credential theft, regulatory penalties (GDPR). |
| **A4** | Worker Computing Resources (CPU/GPU/RAM) | **HIGH** | Service outage, astronomical cloud bills, denial of service for legitimate users. |
| **A5** | Scratch Disk & Storage Volumes | **MEDIUM** | Disk full crash, cross-tenant file leakage. |
| **A6** | Upstream Legal & Platform Compliance | **CRITICAL** | DMCA takedowns, domain seizure, legal liability for unauthorized extraction. |

---

## 4. Threat Enumeration (STRIDE)

### 4.1 Spoofing (S)

#### Threat S1: Client IP Spoofing for Rate Limit Evasion
- **Vector:** An attacker spams requests with spoofed `X-Forwarded-For: <random-ip>` headers to circumvent sliding-window rate limits.
- **Impact:** Abuse of API resources, quota bypass for unauthenticated operations.
- **Mitigation:**
  - Fastify reverse proxy trust configuration: Only accept `X-Forwarded-For` from known upstream reverse proxy CIDRs (Cloudflare / ALB).
  - Rate limiter combines IP address with authenticated session `userId` (`security/src/rate-limiter.ts`).

#### Threat S2: Authentication Token & Session Forgery
- **Vector:** Forging session cookies or JWT tokens to impersonate other users or escalate to admin role.
- **Impact:** Unauthorized access to user history, quota theft, administrative abuse.
- **Mitigation:**
  - Cryptographically secure session tokens stored in PostgreSQL with high-entropy secrets.
  - HttpOnly, Secure, SameSite=Lax/Strict cookie flags.
  - Strict RBAC validation (`admin`, `pro`, `free`) in API gateway.

#### Threat S3: Idempotency Key Replay & Race Conditions
- **Vector:** An attacker sends concurrent duplicate job submission requests with different or forged idempotency keys to reserve multiple quotas before ledger updates.
- **Impact:** Depletion of server resources, exceeding the 10-job/24h free tier rule.
- **Mitigation:**
  - Atomic database transactions with row-level locks on user quotas.
  - Idempotency key tracking in PostgreSQL (`idempotency_key` unique constraint).

---

### 4.2 Tampering (T)

#### Threat T1: Malicious Media File Payloads (Polyglots & Zip Bombs)
- **Vector:** Uploading crafted media files containing embedded payloads, decompression bombs, or malicious container atoms (e.g. malformed MKV/MP4 EBML structures designed to crash demuxers).
- **Impact:** Worker crash, memory exhaustion DoS, potential memory corruption in native codecs.
- **Mitigation:**
  - Media inspection via sandboxed FFprobe with `-protocol_whitelist "file,crypto,data"`.
  - Process limits: strict timeout (max 300s), memory limits (cgroups 4GB), and maxBuffer restrictions.
  - Verification stage: Every processed media output is audited with FFprobe before transitioning to `READY`.

#### Threat T2: Command & Argument Injection into FFmpeg
- **Vector:** Passing shell metacharacters (`;`, `&`, `|`, `` ` ``, `$`, `\n`) in filenames, format options, or titles to trigger command execution.
- **Impact:** Remote Code Execution (RCE) on the media worker container.
- **Mitigation:**
  - Absolute prohibition of shell execution: `spawn` and `execFile` executed strictly with `{ shell: false }`.
  - Strict regex check `SHELL_METACHARS_REGEX` in `security/src/ffmpeg-sanitizer.ts`.
  - Filename sanitization via `sanitizeFilename()` stripping directory paths and non-alphanumeric characters.
  - Whitelisted codec, preset, and resolution builders (`ALLOWED_VIDEO_CODECS`, `ALLOWED_AUDIO_CODECS`, `RESOLUTION_PRESETS`).

#### Threat T3: Request Parameter Tampering (Overriding PRD Rules)
- **Vector:** Submitting JSON payloads with `maxItems: 1000` or `durationSeconds: 999999` to exceed tier allowances.
- **Impact:** System overload, queue starvation.
- **Mitigation:**
  - Strict input schema validation in `security/src/validation.ts`.
  - Hard limit on playlist items (maximum 50 items enforced, rejecting any payload > 50 with `PLAYLIST_CAP_EXCEEDED`).
  - Max duration cap (14,400 seconds = 4 hours max per job).

---

### 4.3 Repudiation (R)

#### Threat R1: Unlogged Job Execution & Quota Bypass
- **Vector:** A user executes downloads and subsequently denies activity, or transactions are completed without ledger audit trails.
- **Impact:** Inability to dispute billing, untraceable abuse, failure of quota accounting.
- **Mitigation:**
  - Transactional Outbox pattern logging every state change in `audit_logs` and `credit_ledger`.
  - All API requests generate and propagate a unique `requestId` across logs.
  - Explicit user rights declaration required upon media inspection before job queuing.

---

### 4.4 Information Disclosure (I)

#### Threat I1: Server-Side Request Forgery (SSRF) to Cloud Metadata & Internal Networks
- **Vector:** An attacker submits URLs pointing to cloud metadata endpoints (`http://169.254.169.254/latest/meta-data/`), internal loopback (`http://127.0.0.1:6379`), or private microservice IPs (`http://10.0.0.5:5432`).
- **Impact:** Cloud IAM credential theft, full cluster compromise, unauthorized internal database manipulation.
- **Mitigation (`security/src/ssrf-guard.ts`):**
  - Full CIDR denylist for IPv4: Loopback (`127.0.0.0/8`), Private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), Link-local (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`), Broadcast (`255.255.255.255/32`), Reserved (`240.0.0.0/4`).
  - Full IPv6 denylist: Loopback (`::1`), Unspecified (`::`), ULA (`fc00::/7`), Link-local (`fe80::/10`), and de-encapsulated IPv4-mapped IPv6 (`::ffff:0:0/96`).
  - Obfuscation decoding: Catches hex (`0x7f000001`), octal (`017700000001`), decimal integer (`2130706433`), and abbreviated IP notations.
  - Cloud metadata hostname denylist (`instance-data`, `metadata.google.internal`).
  - Port restrictions blocking sensitive database/cache ports (22, 5432, 6379, 2375, etc.).

#### Threat I2: DNS Rebinding TOCTOU Attack
- **Vector:** Attacker configures a domain that resolves to a public IP during URL validation, but returns `169.254.169.254` or `127.0.0.1` when the media worker connects.
- **Impact:** SSRF guard bypass.
- **Mitigation:**
  - Multi-record DNS validation: If any resolved A/AAAA record matches a blocked range, the request is denied.
  - Socket IP Pinning in `safeFetch()`: The socket connects directly to the pre-validated pinned IP, passing the host header for SNI.
  - Safe redirect re-validation: Redirects are not blindly followed; each redirect target URL is re-validated through the complete SSRF guard pipeline.

#### Threat I3: Stack Trace & Scratch Path Disclosure
- **Vector:** Triggering FFmpeg or backend errors that output local filesystem paths, internal server IPs, or environment variables in API responses.
- **Impact:** Information leakage aiding targeted exploitation.
- **Mitigation:**
  - Standard error envelope: `{ success: false, error: { code, message, details }, requestId }`.
  - Internal debug stderr is logged to server-side telemetry only and sanitized before any user-facing error reporting.

---

### 4.5 Denial of Service (DoS)

#### Threat D1: Video Transcoding Resource Exhaustion (CPU/GPU Flooding)
- **Vector:** Submitting multiple concurrent 8K transcoding requests or long-duration media files to exhaust CPU and memory.
- **Impact:** Media worker saturation, queue blockage, cascading service failure.
- **Mitigation:**
  - Strict quota limits: 10 individual jobs and 1 playlist job per rolling 24-hour window per user.
  - Job concurrency limits: Worker limits concurrent FFmpeg processes based on CPU core budget (e.g. max 4 threads per job).
  - Stream-copy priority: Media worker defaults to stream copy (`-c:v copy -c:a copy`) whenever codecs are compatible, eliminating unnecessary transcoding CPU burn.
  - Bounded duration: 4-hour max extraction range cap.

#### Threat D2: Scratch Disk Space Exhaustion
- **Vector:** Multiple large video jobs fill up `/tmp` or scratch storage volumes, crashing the worker daemon.
- **Impact:** Worker host outage.
- **Mitigation:**
  - Bounded scratch directory monitoring: Scratch disk quota enforcement.
  - Ephemeral file lifecycle: Scratch files deleted immediately upon upload to S3 or job failure.
  - Automated TTL cleanup daemon for orphan files older than 1 hour.

#### Threat D3: Prototype Pollution & ReDoS
- **Vector:** Submitting nested JSON objects with `__proto__` or crafted regex strings to freeze the Node.js event loop.
- **Impact:** API gateway denial of service.
- **Mitigation:**
  - Prototype pollution scanning and sanitization in `security/src/validation.ts`.
  - ReDoS-safe regex patterns and strict input length bounds (URLs capped at 2048 chars, titles at 255 chars).

---

### 4.6 Elevation of Privilege (EoP)

#### Threat E1: Shell Command Execution via Insecure Process Spawning
- **Vector:** Utilizing vulnerable `child_process.exec(cmdString)` where user inputs are concatenated into a shell string.
- **Impact:** Root or container compromise.
- **Mitigation:**
  - Hard rule: All process execution uses `spawn()` or `execFile()` with an explicit argument array `string[]` and `{ shell: false }`.
  - Verified by `executeSafeFfmpeg()` in `security/src/ffmpeg-sanitizer.ts`.

#### Threat E2: Path Traversal & Arbitrary File Overwrite
- **Vector:** Supplying output paths like `../../etc/cron.d/malicious` to overwrite host system files.
- **Impact:** Root compromise via cron execution or configuration poisoning.
- **Mitigation:**
  - `validateSafePath()` verifies that normalized input and output paths strictly reside inside designated scratch directories.
  - Realpath checks prevent symlink escapes.
  - Filename sanitization strips all directory components.

#### Threat E3: Container Breakout
- **Vector:** An attacker exploits an FFmpeg vulnerability to gain execution inside the container and attempts host breakout.
- **Impact:** Full host virtualization takeover.
- **Mitigation:**
  - Container runs as unprivileged user `UID 10001` (`nobody` / `appuser`), never `root`.
  - Read-only root filesystem (`read_only: true` in Docker/Kubernetes).
  - Linux capabilities dropped: `cap_drop: [ALL]`.
  - `no-new-privileges: true` flag enabled.

---

## 5. Security Controls Mapping Matrix

| Threat ID | Threat Category | Target Component | Security Control / Module | Status |
|---|---|---|---|---|
| **S1** | Spoofing | API Gateway | Trusted Proxy CIDR check + `security/src/rate-limiter.ts` | **IMPLEMENTED** |
| **S2** | Spoofing | Auth / Session | PostgreSQL secure sessions + HttpOnly SameSite cookies | **IMPLEMENTED** |
| **S3** | Spoofing | Quotas | Atomic PostgreSQL transactions + Idempotency constraints | **IMPLEMENTED** |
| **T1** | Tampering | Media Worker | Safe FFprobe validation + Output verification stage | **IMPLEMENTED** |
| **T2** | Tampering | FFmpeg | `security/src/ffmpeg-sanitizer.ts` (`shell: false`, regex filters) | **IMPLEMENTED** |
| **T3** | Tampering | API Gateway | `security/src/validation.ts` (strict 50-item cap, range bounds) | **IMPLEMENTED** |
| **R1** | Repudiation | DB / Audit | `audit_logs` + `credit_ledger` + `outbox_events` | **IMPLEMENTED** |
| **I1** | Info Disclosure | Network / Fetch | `security/src/ssrf-guard.ts` (Full IPv4/IPv6/Metadata CIDRs) | **IMPLEMENTED** |
| **I2** | Info Disclosure | DNS / HTTP | `safeFetch()` IP Pinning + Redirect re-validation | **IMPLEMENTED** |
| **I3** | Info Disclosure | API Gateway | Standardized error envelope + stderr sanitization | **IMPLEMENTED** |
| **D1** | Denial of Service | Processing | Rolling 24h quotas (10 jobs / 1 playlist) + Thread caps | **IMPLEMENTED** |
| **D2** | Denial of Service | Worker Disk | Bounded scratch directory + Immediate post-job cleanup | **IMPLEMENTED** |
| **D3** | Denial of Service | API Gateway | Prototype pollution checks + Max string length limits | **IMPLEMENTED** |
| **E1** | Elevation of Priv | Process Spawn | Safe argument arrays (`string[]`), prohibition of `exec` | **IMPLEMENTED** |
| **E2** | Elevation of Priv | Filesystem | `validateSafePath()` sandbox containment + realpath checks | **IMPLEMENTED** |
| **E3** | Elevation of Priv | Container | Non-root UID 10001, drop capabilities ALL, read-only FS | **IMPLEMENTED** |

---

## 6. Upstream Platform Compliance & Rights Architecture

In strict adherence to project constraints:
1. **No Circumvention:** The system rejects IP proxy rotation, CAPTCHA bypass, and session cookie scraping designed to evade upstream access controls.
2. **Authorized Ingestion:** Permitted media ingestion is restricted to user-uploaded files, user-owned content, and permitted source integration APIs.
3. **YouTube Integration Gate:** YouTube adapter provides metadata and official player preview functionality only. Direct audiovisual stream ripping remains disabled pending formal written agreements.

---

## 7. Residual Risk & Ongoing Assurance

1. **Zero-Day Vulnerabilities in Codecs:** FFmpeg is a complex C codebase. Mitigation relies on defense-in-depth: non-root execution, dropping Linux capabilities, read-only container root filesystems, and bounded process timeouts.
2. **DNS Provider Latency:** DNS lookup during SSRF validation introduces 10-30ms latency on the initial `/media/inspect` request. This is an accepted engineering trade-off to ensure complete SSRF and DNS rebinding immunity.
3. **Automated Regression Testing:** All security controls are verified on every CI run via `security/tests/ssrf.test.ts`, `security/tests/ffmpeg-sanitizer.test.ts`, `security/tests/rate-limiter.test.ts`, and `security/tests/validation.test.ts`.
