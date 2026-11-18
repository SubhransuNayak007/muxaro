# System Architecture & Component Specification
**Project:** MUXARO Media Processing Platform (Formerly Project VYRO)  
**Author:** Principal Architect & System Designer (AGENT 01)  
**Document Status:** Approved Engineering Architecture  
**Brand Identity:** MUXARO — "Your Media. One Powerful Workspace."  
**Target Scale:** 100,000 Concurrent Web Sessions / Distributed Worker Fleet  
**Last Updated:** November 2026  

---

## 1. Architectural Philosophy & Principles

The MUXARO system is architected as an asynchronous, event-driven, decoupled media processing platform. The design is governed by five non-negotiable architectural axioms:

1. **Clean Asynchronous Decoupling:** Heavy computational tasks (media downloading, audio extraction, video transcoding, remuxing, zip packaging) are strictly prohibited from occurring within HTTP request-response cycles. Web requests only perform lightweight metadata operations, admission checks, and atomic state transitions; all media byte manipulation is offloaded to a horizontally scalable worker fleet.
2. **Strict Trust Boundaries & SSRF Immunity:** The system treats all user-supplied input—specifically media URLs, uploaded file headers, and metadata tags—as potentially hostile. Egress inspection is isolated behind a hardened network proxy with DNS rebinding defenses and private IP range filtering (RFC 1918 / RFC 3927).
3. **Stream-Copy First (Zero Generational Loss):** Transcoding video or audio introduces CPU/GPU bottlenecks and degrades fidelity. The pipeline prioritizes stream-copy multiplexing (`-c:v copy -c:a copy`) whenever source codecs are compatible, achieving speeds bounded only by I/O throughput.
4. **Authentic Quality Transparency:** Unlike predatory converter utilities that fabricate 320 kbps MP3 files from 128 kbps Opus streams or fake 8K upscales, MUXARO enforces honest reporting of true source codecs, container formats, bitrates, and channels.
5. **Transactional Consistency & Atomic Quotas:** All job submissions, quota reservations, and ledger state changes use PostgreSQL ACID transactions combined with the Transactional Outbox Pattern to guarantee that no job is enqueued without quota reservation, and no quota is permanently lost on job cancellation or systemic failure.

---

## 2. High-Level System Component Diagram

```mermaid
flowchart TD
    subgraph ClientZone ["Client Zone (Untrusted)"]
        Browser["Modern Web Client (Next.js 14 SPA / Mobile Safari / Chrome)"]
    end

    subgraph EdgeZone ["Edge & CDN Ingress Zone"]
        CF["Cloudflare / Edge CDN (WAF, DDoS Shield, SSL Termination)"]
        StaticS3["Static Assets & Web Frontend CDN Cache"]
    end

    subgraph IngressVPC ["Ingress VPC / DMZ (Public Subnet)"]
        ALB["Application Load Balancer (ALB)"]
        WebTier["apps/web (Next.js 14 SSR/Node Cluster)"]
        APIGateway["apps/api (Fastify High-Throughput HTTP / SSE Gateway)"]
    end

    subgraph SecurityBoundary ["Security & Isolation Layer"]
        SSRFGuard["security/ssrf-guard (DNS Rebinding & CIDR Sanitizer)"]
        TokenAuth["Session & Signed Token Auth (HMAC / JWT / Session Store)"]
    end

    subgraph SharedPackages ["Monorepo Core Logic Packages"]
        SourceAdapters["packages/source-adapters (DirectMedia & YouTube Permitted)"]
        Entitlements["packages/entitlements (Rolling 24h Quota & Credit Ledger)"]
    end

    subgraph StateTier ["State & Messaging Subnet (Private Isolated)"]
        Postgres[(PostgreSQL 16 Multi-AZ Primary + Read Replicas)]
        OutboxRelay["Transactional Outbox Relay / CDC Worker"]
        Redis[(Redis 7 Cluster: BullMQ Queues + Cache + Pub/Sub)]
    end

    subgraph WorkerFleet ["Compute Subnet (Isolated Private Worker VPC)"]
        Dispatcher["Queue Consumer / Job Dispatcher"]
        WorkerPool["apps/media-worker (Sandboxed Node.js + FFmpeg/FFprobe Fleet)"]
        EphemeralDisk["Bounded Ephemeral Scratch Storage (NVMe /tmp)"]
    end

    subgraph StorageSubnet ["Object Storage Subnet"]
        S3["Object Storage (MinIO / AWS S3 - Chunked Storage)"]
        SignedURL["Pre-Signed Time-Limited Download URLs"]
    end

    %% Ingress Flows
    Browser -->|HTTPS / WSS| CF
    CF -->|Static Cache| StaticS3
    CF -->|Dynamic Requests| ALB
    ALB -->|SSR Web Traffic| WebTier
    ALB -->|API Requests & SSE| APIGateway
    WebTier -->|BFF API Calls| APIGateway

    %% API Validation & Modules
    APIGateway --> SecurityBoundary
    APIGateway --> SharedPackages
    SSRFGuard -->|Egress Probe| SourceAdapters
    APIGateway -->|ACID Reservation & State| Postgres
    APIGateway -->|Direct Job Status / SSE Events| Redis

    %% Asynchronous Processing Flow
    Postgres -->|Outbox Events| OutboxRelay
    OutboxRelay -->|Enqueue Job with Backpressure| Redis
    Redis -->|Pull Jobs (Fair-Share Weighted)| Dispatcher
    Dispatcher --> WorkerPool
    WorkerPool --> EphemeralDisk
    WorkerPool -->|Persist Verified Artifact| S3
    WorkerPool -->|State Updates & Events| Redis
    WorkerPool -->|Terminal Job Status (READY/FAILED)| Postgres

    %% Delivery Flow
    Browser -->|Direct Download via Signed URL| S3
    APIGateway -->|Generate Signed Download Link| SignedURL
```

---

## 3. Trust Zones & Network Boundaries

| Zone | Network Tier | Accessible Ports | Ingress Rules | Egress Rules |
| :--- | :--- | :--- | :--- | :--- |
| **Zone 0: Client** | Public Internet | 443 (HTTPS) | Any Client | Cloudflare Edge IPs Only |
| **Zone 1: DMZ / Web & API** | Public Subnets (VPC 1) | 3000 (Web), 4000 (API) | Cloudflare Edge IPs -> ALB | Internal VPCs only + Monitored HTTPS Egress for Inspection |
| **Zone 2: State & Queues** | Private Isolated Subnet (VPC 1) | 5432 (Postgres), 6379 (Redis) | API Gateway & Worker Subnets Only | No Public Egress Permitted |
| **Zone 3: Worker Compute** | Private Worker VPC (VPC 2) | Internal gRPC / IPC / Redis client | No Public Ingress; Pull-based from Redis | Egress strictly through NAT with SSRF Proxy for media fetch |
| **Zone 4: Storage** | Private Object Store VPC | 9000 (S3 API), 9001 (Console) | Worker VPC (write) & API Gateway (sign) | S3 Bucket to CDN / Direct Signed GET |

---

## 4. End-to-End Execution Lifecycles

### 4.1 Synchronous Media Inspection Lifecycle
Inspection is synchronous and fast (target latency: <500ms):

```
Client (User)           API Gateway (/inspect)           SSRF Guard           Source Adapter          Remote Host
      │                          │                            │                      │                     │
      │── 1. POST /media/inspect ─►                           │                      │                     │
      │   { url, rightsDeclared }│                            │                      │                     │
      │                          │── 2. Validate URL Target ─►│                      │                     │
      │                          │   (Resolve DNS, Check CIDR)│                      │                     │
      │                          │◄── 3. Target Approved ─────│                      │                     │
      │                          │                                                   │                     │
      │                          │── 4. Dispatch to Source Adapter ─────────────────►│                     │
      │                          │   (DirectMediaAdapter or PermittedYouTube)        │                     │
      │                          │                                                   │── 5. HEAD / oEmbed ─►
      │                          │                                                   │◄── 6. Stream Headers │
      │                          │◄── 7. Normalized Media Manifest ──────────────────│                     │
      │                          │   (Title, Streams: Video/Audio/Bitrates/Codecs)   │                     │
      │                          │                                                   │                     │
      │                          │── 8. Cache Manifest in Redis (TTL: 1h)            │                     │
      │◄── 9. Response JSON ─────│                                                   │                     │
      │   { success: true, data: { assetId, streams, duration, thumbnail } }         │                     │
```

### 4.2 Asynchronous Processing & Delivery Lifecycle

```
Client (User)        API Gateway (/jobs)      Postgres / Ledger         Redis / BullMQ          Media Worker Fleet       Object Store (S3)
      │                     │                        │                        │                        │                       │
      │── 1. POST /jobs ───►│                        │                        │                        │                       │
      │  (AssetId, Options, │                        │                        │                        │                       │
      │   IdempotencyKey)   │                        │                        │                        │                       │
      │                     │── 2. BEGIN TX ────────►│                        │                        │                       │
      │                     │   a. Check Idempotency │                        │                        │                       │
      │                     │   b. Reserve Quota     │                        │                        │                       │
      │                     │   c. Insert JobRecord  │                        │                        │                       │
      │                     │   d. Insert OutboxEvent│                        │                        │                       │
      │                     │── 3. COMMIT TX ───────►│                        │                        │                       │
      │◄── 4. 202 Accepted ─│                        │                        │                        │                       │
      │   { jobId, status:  │                        │                        │                        │                       │
      │     "QUEUED" }      │                        │                        │                        │                       │
      │                     │                        │── 5. Relay Outbox ────►│                        │                       │
      │                     │                        │   (Enqueue Job)        │                        │                       │
      │                     │                        │                        │── 6. Fetch Next Job ──►│                       │
      │                     │                        │                        │   (Status: PROCESSING) │                       │
      │                     │                        │                        │                        │── 7. Fetch Chunks/Src │
      │                     │                        │                        │                        │── 8. FFmpeg Process   │
      │                     │                        │                        │                        │   (-c copy or remux)  │
      │                     │                        │                        │                        │── 9. FFprobe Verify ─►│
      │                     │                        │                        │                        │── 10. Upload Artifact                ──►│
      │                     │                        │                        │                        │   (S3 PutObject)      │
      │                     │                        │◄── 11. Mark READY ─────┼────────────────────────│                       │
      │                     │                        │    Record Artifact Key │                        │                       │
      │                     │                        │    Consume Quota Perm. │                        │                       │
      │                     │                        │                        │◄── 12. Publish Event ──│                       │
      │                     │                        │                        │    (job:completed)     │                       │
      │── 13. GET /jobs/:id ┼────────────────────────┼───────────────────────►│                        │                       │
      │   /events (SSE)     │◄───────────────────────┼────────────────────────│                        │                       │
      │◄── 14. SSE Progress ┼────────────────────────┴────────────────────────┘                        │                       │
      │   { status: "READY", downloadUrl: "/api/v1/jobs/:id/download" }                                │                       │
      │                     │                                                                          │                       │
      │── 15. GET /download►│                                                                          │                       │
      │◄── 16. 302 Redirect ┼──────────────────────────────────────────────────────────────────────────┴──────────────────────►│
      │    (Signed URL)     │                                                                          (Streams File directly) │
```

---

## 5. Subsystem Component Breakdown

### 5.1 Web Application (`apps/web`)
- **Framework:** Next.js 14 App Router, TypeScript strict mode, Tailwind CSS.
- **Design Standard:** Strict Hallmark Anti-AI-Slop compliance. Zero arbitrary hex colors or fonts; all styling binds to `:root` design tokens. Fluid typographic scale with `clamp()`. Instant `:focus-visible` ring triggers. No fake counters, unearned metric claims, or artificial spin delays.
- **State & Communication:** Native fetch wrappers communicating with `apps/api`. Real-time event consumption via Server-Sent Events (`EventSource`).
- **Pages & Routes:**
  - `/`: Master Hero URL analyzer & Inspection Card.
  - `/tools`: Suite index for Audio Extractor, Video Merger, Media Converter, Batch Processor.
  - `/credits`: Honest Quota Ledger and dynamic rolling 24-hour reset countdown.
  - `/dashboard`: User job history, active queue tracker, account settings.
  - `/admin`: SRE overview, active queue depth, worker node health, error rate dashboard.
  - `/status`: Operational service status and component latencies.
  - `/docs`: Educational resources (Resolutions, Audio formats, Codec guides).
  - `/legal`: Terms of Service, Privacy Policy, DMCA Copyright Notice.

### 5.2 API Gateway Service (`apps/api`)
- **Framework:** Fastify 4.x (Node.js LTS), TypeScript. Chosen for sub-millisecond route dispatch overhead and schema-based JSON serialization.
- **Validation:** JSON Schema validation via Ajv on every input and query parameter.
- **Security Middleware:**
  - Fastify Helmet with strict Content Security Policy.
  - Rate limiting keyed by IP and Authenticated User ID.
  - SSRF protection via `security/ssrf-guard`.
- **Response Protocol:** Uniform JSON envelope:
  - Success: `{ "success": true, "data": T, "requestId": string }`
  - Failure: `{ "success": false, "error": { "code": string, "message": string, "details": any }, "requestId": string }`
- **Streaming Endpoints:** Native Server-Sent Events (SSE) via Fastify reply streaming for `/api/v1/jobs/:id/events`.

### 5.3 Distributed Media Processing Fleet (`apps/media-worker`)
- **Runtime:** Node.js LTS worker daemon wrapped in isolated, non-root Linux containers.
- **Queue Engine:** BullMQ worker connecting to Redis Cluster.
- **Concurrency & Resource Isolation:** Bounded concurrency per container (default: 2 video transcode tasks or 6 audio/remux tasks per 4-core worker).
- **Process Orchestration:** Child processes spawned via `execFile` with explicit argument arrays (never shell interpolation).
- **Execution Strategy:**
  1. **Probe:** Execute `ffprobe -v quiet -print_format json -show_format -show_streams` on input.
  2. **Stream-Copy Evaluation:** If container conversion does not require re-encoding, apply `-c copy`.
  3. **Audio Extraction:** Extract direct native stream without generational loss; transcode only when requested by user format options.
  4. **Merge Operations:** Remux audio and video tracks with `-c:v copy -c:a copy -movflags +faststart`.
  5. **Output Verification:** Mandatory FFprobe integrity check on output file. Verify duration match (within ±1.0s), stream presence, non-zero byte size, and absence of corrupted frames.
  6. **Scratch Disk Discipline:** All intermediate chunks and scratch files in `/tmp/muxaro-scratch/{jobId}` are removed in a `finally` block regardless of task outcome.

### 5.4 Shared Packages & Libraries
- **`packages/source-adapters`:** Encapsulates the adapter interface (`SourceAdapter`, `MediaManifest`, `MediaStream`). Houses `DirectMediaAdapter` and `YouTubePermittedAdapter`. Strictly enforces permitted metadata-only boundaries for YouTube.
- **`packages/entitlements`:** Implements atomic quota calculation, sliding rolling-window checks, credit transaction ledger logic, and RBAC role resolution.
- **`security/`:** Implements `SSRFGuard`, input sanitization, and FFmpeg safe argument array formatters.

---

## 6. Monorepo Directory Organization

```
muxaro/
├── apps/
│   ├── api/                     # Fastify TypeScript REST & SSE API Gateway
│   ├── media-worker/            # Distributed FFmpeg/FFprobe Worker Daemon
│   └── web/                     # Next.js 14 Hallmark-Compliant Web Application
├── packages/
│   ├── entitlements/            # Quota engine, rolling window, credit ledger
│   └── source-adapters/         # Pluggable media source adapters & rights validation
├── security/                    # SSRF Guard, CIDR filters, command sanitization
├── infra/                       # Dockerfiles, Docker Compose, Terraform, K8s manifests
├── docs/                        # Architecture specs, PRD, brand research, audit
│   ├── architecture/            # System overview, state machine, DDL, OpenAPI, ADRs
│   │   ├── adr/                 # Architecture Decision Records (001-006)
│   │   ├── database-schema.md   # Relational data model specification
│   │   ├── openapi.yaml         # Authoritative OpenAPI 3.1 specification
│   │   ├── queue-state-machine.md # Queue lifecycle & state transition spec
│   │   ├── schema.sql           # Complete PostgreSQL 16 DDL & migrations
│   │   └── system-overview.md   # This document
│   ├── BRAND_RESEARCH.md        # Trademark clearance & PureMux recommendation
│   ├── CAPACITY_PLAN.md         # 100K concurrent user scaling blueprint
│   ├── MASTER_PRD.md            # Master Product Requirements Document
│   └── REFERENCE_AUDIT.md       # Deep audit of YoutubeGO & SnapWC
├── qa/                          # QA reports, bug register, load test harness
└── tests/                       # Automated unit, integration, and security test suites
```

---
*Signed by AGENT 01 (Principal Architect & System Designer)*  
*Distribution: Swarm Board (@coordinator, @api, @frontend, @media, @adapters, @entitlements)*
