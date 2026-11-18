# MUXARO Platform Capacity Engineering & Production Sizing Plan
**Target Concurrency:** 100,000 Concurrent Active Users (CCU)  
**System Domain:** High-Throughput Media Inspection, Remuxing & Transcoding Platform  
**Author:** Cloud Infrastructure and SRE Engineer (AGENT 07)  
**Document Status:** Approved Production Baseline  
**Revision:** 2.0 (November 2026 - Rebranded to MUXARO)  

---

## 1. Executive Summary & Objective

The objective of this capacity plan is to establish a rigorous, mathematically grounded sizing model for Project MUXARO under sustained and peak operational conditions of **100,000 Concurrent Active Users (CCU)**.

Media processing utilities present a unique dual-mode architectural challenge:
1. **Interactive Web & API Plane:** Highly concurrent, I/O-bound, low-latency requests (metadata inspection, capability queries, quota validation, job status polling).
2. **Asynchronous Media Execution Plane:** Compute-bound, memory-intensive, disk-I/O-heavy operations (stream downloading, FFprobe probing, multi-stream multiplexing, audio extraction, video transcoding, checksum hashing, and artifact streaming).

This document decouples these operational planes, maps user journeys to quantitative workloads, sizes every architectural tier (CDN, Ingress, API, Cache, Database, Message Queue, Media Transcoding Workers, and Object Storage), models cost projections with optimization strategies, and defines automated scaling and resilience gates.

---

## 2. Workload & User Behavior Model (100k CCU)

### 2.1 User Concurrency Breakdown
At peak 100,000 CCU, users are distributed across four discrete behavioral states:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       100,000 CONCURRENT USERS (CCU)                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       ▼                               ▼                               ▼
  70,000 (70%)                    25,000 (25%)                    5,000 (5%)
Browsing / Reading               Inspecting URLs             Active Processing
Static content, guides,        Media metadata probes,       Jobs in queue or active
SEO landing pages, FAQ,        format selector queries,     FFmpeg remux/transcode,
documentation, legal pages     quota checks                 artifact downloading
       │                               │                               │
       ▼                               ▼                               ▼
Edge Cache (Cloudflare)         Fastify API Cluster          Media Worker Fleet
Edge Cache Hit: 92%            Cache + DB Validation        Compute / NVMe Bound
```

| User Category | % of CCU | User Count | Dominant Activity | Primary Resource Consumed |
|---|---|---|---|---|
| **Browsers / Readers** | 70% | 70,000 | Reading docs, tools index, pricing, home view | CDN Edge, Memory cache |
| **Inspectors / Evaluators** | 25% | 25,000 | Pasting URLs, inspecting streams, checking formats | API, Outbound SSRF guard, Redis cache |
| **Active Transcoders** | 5% | 5,000 | Actively waiting for or running a job | SQS, Worker CPU/RAM, NVMe disk, S3 |
| **Downloading Finished Files**| (Subset) | ~2,500 | Fetching completed MP4/MP3/M4A artifacts | Direct S3 Presigned URLs / Cloudflare CDN |

### 2.2 User Session Dynamics & Interaction Rates
- **Average Session Duration ($T_{session}$):** 12 minutes (720 seconds).
- **Session Arrival Rate:** $\lambda_{session} = \frac{100,000}{720} \approx 138.8\text{ new sessions/sec}$.
- **Inspect Actions per Active Session:** 2.4 inspections/session $\rightarrow \frac{25,000 \times 2.4}{720} \approx 83.3\text{ inspections/sec}$.
- **Job Submissions per Active Session:** 0.6 submissions/session $\rightarrow \frac{100,000 \times 0.6}{720} \approx 83.3\text{ jobs/sec}$ peak submission rate.
- **Normalized Job Submission Rate (incorporating daily quotas):**
  - Free tier limit: 10 individual jobs/rolling 24h.
  - Steady-state production job arrival rate: **35.0 jobs/sec** (average); **75.0 jobs/sec** (burst peak).

---

## 3. Tier-by-Tier Capacity & Throughput Calculations

```
                                  [ INTERNET ]
                                       │
                                       ▼
                     [ Cloudflare Enterprise / Business ]
                        (DDoS, WAF, SSL, Edge Caching)
                                       │
                  ┌────────────────────┴────────────────────┐
                  │ 92% Edge Hit                            │ 8% Origin Miss
                  ▼                                         ▼
            [ Edge Cache ]                    [ AWS Application Load Balancer ]
                                                            │
                       ┌────────────────────────────────────┴──────────────┐
                       ▼                                                   ▼
             [ Web Tier (Next.js) ]                              [ API Tier (Fastify) ]
             Auto-scaled ECS Tasks                               Auto-scaled ECS Tasks
                       │                                                   │
                       │                        ┌──────────────────────────┼─────────────────────┐
                       │                        ▼                          ▼                     ▼
                       │                 [ Redis Cluster ]          [ RDS PostgreSQL ]    [ AWS SQS ]
                       │                  Sessions & Quotas         Primary + Read Rep    Job Queue & DLQ
                       │                                                                         │
                       │                                                                         ▼
                       │                                                           [ Media Transcoding Fleet ]
                       │                                                            EC2 Autoscaling Group
                       │                                                            (c6i/c7g Compute + NVMe)
                       │                                                                         │
                       └────────────────────────────────┬────────────────────────────────────────┘
                                                        ▼
                                             [ AWS S3 Object Storage ]
                                             (Raw Ingestion + Artifacts)
```

### 3.1 Tier 1: Ingress & Web Tier (Next.js Frontend)
- **Edge Requests (Cloudflare):**
  - Average page weight: ~450 KB (HTML, CSS, modern JS chunks, SVGs).
  - 100k users navigating an average of 4 pages/session $\rightarrow 400,000\text{ page requests}/720\text{s} \approx 555\text{ page views/sec}$.
  - Static asset requests (JS chunks, icons, fonts): $\approx 4,500\text{ req/sec}$ peak.
  - **Edge Cache Hit Ratio ($H_{edge}$):** 92% for static bundles and documentation pages.
- **Origin Web Requests (Next.js SSR/ISR & Dynamic Shell):**
  - Origin Web RPS: $4,500 \times (1 - 0.92) + 555 \approx 915\text{ RPS origin}$.
  - Next.js Task Capacity: Each container task (1 vCPU, 2 GB RAM) handles ~120 RPS of dynamic SSR/hydration rendering.
  - **Required Web Tasks:** $\lceil \frac{915}{120} \times 1.4\text{ (headroom)} \rceil = 11\text{ tasks}$.
  - **Sizing:** 12 to 16 tasks (1 vCPU, 2 GB RAM) across 3 AZs.

### 3.2 Tier 2: API Tier (Fastify REST Service)
Fastify provides an asynchronous event loop with extreme JSON throughput.
- **API Request Breakdown:**
  1. `/api/v1/auth/session` & `/api/v1/me`: 150 RPS.
  2. `/api/v1/media/inspect`: 85 RPS (cached in Redis for 10m where appropriate).
  3. `/api/v1/entitlements` & `/api/v1/credits`: 120 RPS.
  4. `/api/v1/jobs` (create/cancel/retry): 75 RPS.
  5. `/api/v1/jobs/:id` (polling status / SSE): 1,800 RPS (assuming 3,600 users polling every 2s).
  6. `/api/v1/jobs/:id/download`: 50 RPS.
  - **Total Peak API RPS:** **2,280 RPS** (rounded to **2,500 RPS** for engineering headroom).
- **Per-Task Performance:**
  - Fastify microservice benchmarked on Node 22: ~600 RPS per task (2 vCPU, 4 GB RAM) with DB/Redis connection pooling.
  - **Required API Tasks:** $\lceil \frac{2,500}{600} \times 1.5\text{ headroom} \rceil = 7\text{ tasks}$.
  - **Sizing:** Baseline **8 tasks**, auto-scaling up to **20 tasks** during extreme surges.

### 3.3 Tier 3: In-Memory Cache (Redis)
Redis serves three primary functions: session token lookup, distributed rate limiting (sliding window), and inspection result caching.
- **Operations per Second (IOPS):**
  - Rate limiting checks: ~2,500 ops/sec.
  - Session validations: ~2,000 ops/sec.
  - Ephemeral cache gets/sets: ~500 ops/sec.
  - Total Redis Command Rate: **~5,000 ops/sec**.
- **Memory Footprint:**
  - Active user sessions: $100,000 \times 1.5\text{ KB} = 150\text{ MB}$.
  - Rate limit counters (IP + User IDs): $200,000 \times 200\text{ bytes} = 40\text{ MB}$.
  - Media inspection metadata cache: $50,000 \times 8\text{ KB} = 400\text{ MB}$.
  - Total Working Set: $< 1.5\text{ GB}$.
- **Hardware Selection:** AWS ElastiCache for Redis `cache.m6g.large` (2 vCPU, 6.38 GB RAM) in Multi-AZ cluster configuration with automatic failover. Max throughput: > 60,000 ops/sec (12x headroom).

### 3.4 Tier 4: Relational Database (PostgreSQL 16)
- **Write Operations:**
  - Job creation: 35 writes/sec.
  - State transitions (`CREATED` $\rightarrow$ `QUEUED` $\rightarrow$ `PROCESSING` $\rightarrow$ `VERIFYING` $\rightarrow$ `READY`): $35 \times 4 = 140\text{ writes/sec}$.
  - Quota reservation & outbox events: $35 \times 2 = 70\text{ writes/sec}$.
  - Audit logging: 80 writes/sec.
  - Total Write IOPS: **~325 writes/sec**.
- **Read Operations:**
  - Job polling (status queries): Handled via Redis cache or Read Replica. Total Read QPS: ~800 QPS.
- **Connection Management:**
  - API tasks (20 tasks $\times$ 25 connections max pool) = 500 connections.
  - Media worker nodes = 150 connections.
  - Managed connection pooling via **PgBouncer / AWS RDS Proxy** caps connections to the PostgreSQL engine at 80 connections, preventing connection exhaustion and context-switching overhead.
- **Hardware Selection:**
  - AWS RDS PostgreSQL Multi-AZ `db.r6g.xlarge` (4 vCPU, 32 GB RAM, Provisioned IOPS 3,000 gp3).
  - One Read Replica `db.r6g.large` for analytics and admin reporting.

---

## 4. Media Transcoding Fleet & Queue Dynamics

Media processing is the critical cost and capacity driver. To model this accurately, operations are categorized into three distinct execution archetypes:

### 4.1 Job Execution Archetypes
1. **Type 1: Fast Stream-Copy / Remuxing (60% of jobs)**
   - Operation: `-c copy -movflags +faststart` (multiplexing DASH video + audio or container change).
   - CPU Profile: I/O bound. Average runtime: **4.0 seconds**.
   - Resource Demand: 1 vCPU, 1 GB RAM, 200 MB disk scratch.
2. **Type 2: Audio Extraction & Conversion (25% of jobs)**
   - Operation: Native audio copy or fast transcode to MP3/AAC.
   - CPU Profile: Light CPU. Average runtime: **3.5 seconds**.
   - Resource Demand: 1 vCPU, 512 MB RAM, 100 MB disk scratch.
3. **Type 3: Full Video Transcoding / Resolution Downsampling (15% of jobs)**
   - Operation: H.264/HEVC/AV1 decode and encode, video filter processing, resizing.
   - CPU Profile: Highly compute bound. Average runtime: **45.0 seconds**.
   - Resource Demand: 2 vCPU, 2 GB RAM, 1.5 GB disk scratch.

### 4.2 Weighted Average Processing Time ($W_{proc}$)
$$W_{proc} = (0.60 \times 4.0\text{s}) + (0.25 \times 3.5\text{s}) + (0.15 \times 45.0\text{s}) = 2.4 + 0.875 + 6.75 = \mathbf{10.025\text{ seconds}}$$

### 4.3 Queue Backlog & Sizing using Little’s Law
By Little's Law, the average number of jobs actively in progress ($L$) is given by:
$$L = \lambda \times W$$

Where:
- $\lambda = 35.0\text{ jobs/second}$ (steady-state arrival rate at 100k CCU).
- $W = 10.025\text{ seconds}$ (mean processing duration).

$$L = 35.0 \times 10.025 = \mathbf{351\text{ concurrent active jobs in flight}}$$

During a peak 15-minute surge ($\lambda_{surge} = 75.0\text{ jobs/sec}$):
$$L_{surge} = 75.0 \times 10.025 = \mathbf{752\text{ concurrent active jobs in flight}}$$

### 4.4 Worker Fleet Sizing
A production media worker container is configured with **2 vCPU and 4 GB RAM**.
- Each worker container executes **2 parallel stream-copy jobs** OR **1 full video transcode job**.
- Average concurrency per container: **1.6 jobs/container**.

**Container Requirement:**
- **Steady State:** $\frac{351}{1.6} \approx \mathbf{220\text{ worker containers}}$.
- **Surge Peak:** $\frac{752}{1.6} \approx \mathbf{470\text{ worker containers}}$.
- **Host VM Packing:** Utilizing AWS EC2 `c6i.4xlarge` (16 vCPU, 32 GB RAM, NVMe scratch instance storage):
  - Each `c6i.4xlarge` hosts 7 worker containers (leaving 2 vCPU + 4 GB RAM for OS, Docker daemon, logging, and I/O buffer).
  - Steady State Fleet: $\lceil \frac{220}{7} \rceil = \mathbf{32\text{ EC2 instances}}$.
  - Peak Surge Fleet: $\lceil \frac{470}{7} \rceil = \mathbf{68\text{ EC2 instances}}$.

### 4.5 Auto-Scaling Model & Queue Thresholds
The worker fleet scales based on **Queue Backlog per Worker**:
$$\text{Backlog Ratio} = \frac{\text{SQS ApproximateNumberOfMessagesVisible}}{\text{Current Active Workers}}$$

- **Scale-Up Rule:** If $\text{Backlog Ratio} > 3.0$ for 45 seconds $\rightarrow$ Add 20% instances.
- **Scale-Down Rule:** If $\text{Backlog Ratio} < 0.5$ for 300 seconds $\rightarrow$ Terminate idle instances safely (draining current jobs before termination).
- **Spot Instance Diversification:**
  - **75% Spot Instances:** Mixed across `c6i.4xlarge`, `c6a.4xlarge`, `c7g.4xlarge` (ARM Graviton3), `c5.4xlarge`.
  - **25% On-Demand Instances:** Guarantees guaranteed baseline capacity even during regional Spot reclaim events.

---

## 5. Storage & Bandwidth Sizing

### 5.1 Storage Lifecycle & Retention Policy
Media artifacts are strictly ephemeral. No long-term video archiving is offered:
- **Scratch Space (Worker Local):** Ephemeral NVMe volume mounted at `/tmp/muxaro-scratch`. Files are wiped immediately upon artifact upload to S3 or job failure.
- **S3 Object Storage:**
  - Raw Uploads Bucket: Lifecycle rule deletes all objects after **2 hours**.
  - Processed Artifacts Bucket: Lifecycle rule deletes all objects after **24 hours**.

### 5.2 Storage Capacity Calculation
- Daily Completed Jobs: $35\text{ jobs/sec} \times 86,400\text{s} = 3,024,000\text{ jobs/day}$.
- Average Artifact Size:
  - Audio files (MP3/M4A/FLAC): 8 MB (35% of output)
  - 720p/1080p MP4: 85 MB (55% of output)
  - 4K/UHD Video: 350 MB (10% of output)
  - Weighted Average Size: $(0.35 \times 8) + (0.55 \times 85) + (0.10 \times 350) = 2.8 + 46.75 + 35.0 = \mathbf{84.55\text{ MB}}$.
- Peak 24-Hour Active Storage:
  $$3,024,000 \times 84.55\text{ MB} \approx 255.6\text{ TB active retained storage}.$$

### 5.3 Network Egress & CDN Bandwidth
- **Raw Download Egress:**
  - Total Daily Egress: $\approx 255\text{ TB / day}$.
  - Average Bandwidth: $\frac{255 \times 10^{12} \times 8\text{ bits}}{86,400\text{s}} \approx \mathbf{23.6\text{ Gbps sustained}}$.
  - Peak Egress Bandwidth (2.5x multiplier): **~59.0 Gbps peak**.
- **Bandwidth Optimization via Cloudflare Enterprise / CloudFront:**
  - By routing artifact downloads through Cloudflare with AWS Bandwidth Alliance (or CloudFront origin access control with volume commitments), standard AWS $0.09/GB egress pricing is reduced by 60–85%.

---

## 6. Comprehensive Cost Analysis (Monthly TCO)

The following financial model evaluates both standard on-demand pricing and an optimized production architecture (Spot instances, 1-year Savings Plans, Bandwidth Alliance).

| Component | Architecture Specification | Unoptimized Monthly Cost | Optimized Monthly Cost | Optimization Strategy |
|---|---|---|---|---|
| **CDN & WAF** | Cloudflare Enterprise / Business + WAF | $3,500 | $2,800 | Annual contract with Bandwidth Alliance |
| **Ingress (ALB)** | 2x AWS Application Load Balancers | $180 | $180 | Redundant Multi-AZ |
| **Web Tier** | 16x ECS Fargate Tasks (1 vCPU, 2 GB) | $560 | $380 | Compute Savings Plan (32% discount) |
| **API Tier** | 12x ECS Fargate Tasks (2 vCPU, 4 GB) | $840 | $570 | Compute Savings Plan (32% discount) |
| **Media Workers** | 32–68x EC2 `c6i.4xlarge` (Average: 40 instances) | $19,584 | $6,250 | **75% Spot Fleet ($0.16/hr vs $0.68/hr)** + 25% Savings Plan |
| **Database** | RDS Postgres Multi-AZ `db.r6g.xlarge` + Replica | $1,240 | $830 | 1-year Reserved Instance |
| **Cache** | ElastiCache Redis Multi-AZ `cache.m6g.large` | $310 | $210 | 1-year Reserved Instance |
| **Message Queue**| AWS SQS (150M requests/month) | $60 | $60 | Standard tier (pay per request) |
| **Object Storage**| AWS S3 Standard (Avg 260 TB active) | $5,980 | $4,100 | S3 Intelligent-Tiering + strict 24h expiration |
| **Data Egress** | 7.6 Petabytes / month (Peak traffic) | $38,000 | $9,500 | **Cloudflare Bandwidth Alliance (egress waived/discounted)** |
| **Monitoring** | Datadog / CloudWatch Logs & Metrics | $1,400 | $950 | Metric sampling and 7-day log retention |
| **TOTAL** | | **$71,654 / mo** | **$25,830 / mo** | **64.0% Overall Cost Reduction** |

### Cost per Processed Media Job:
- Monthly Processed Jobs: $3,024,000 \times 30 = \mathbf{90,720,000\text{ jobs/month}}$.
- **Fully Loaded Cost Per Job:** $\frac{\$25,830}{90,720,000} = \mathbf{\$0.000285\text{ per job}}$ (less than 3/100ths of a cent per conversion).

---

## 7. Service Level Indicators (SLIs) & Service Level Objectives (SLOs)

As defined in the SRE framework, production reliability is governed by quantitative error budgets:

| Service Tier | SLI Definition | Target SLO (30-day window) | Error Budget | Alerting Burn Rate Thresholds |
|---|---|---|---|---|
| **API Availability** | $\frac{\text{Count}(\text{HTTP status} < 500)}{\text{Total API Requests}}$ | **99.95%** | 0.05% (~1,250 failed reqs/day) | Critical: 14.4x burn in 1h<br>Warning: 6x burn in 6h |
| **API Latency** | $\frac{\text{Count}(\text{Duration} \le 120\text{ms})}{\text{Total Valid Requests}}$ | **99.0%** (p99) | 1.0% | P99 > 250ms for 5m |
| **Job Success Rate**| $\frac{\text{Count}(\text{Job Status} = \text{READY})}{\text{Total Valid Jobs Completed}}$ | **99.5%** | 0.5% | Consecutive worker failures > 3 |
| **Queue Wait Time**| $\text{Time from QUEUED to PROCESSING}$ | **p95 < 20s, p99 < 45s** | 5.0% exceeding 20s | Queue backlog > 1,500 messages |
| **Remux Speed** | $\frac{\text{Remux Duration}}{\text{Media Duration}}$ (Realtime Factor) | **$\le 0.05\times$** (20x faster than real-time) | 2.0% | Disk I/O saturation > 85% |

---

## 8. Failure Modes & Disaster Recovery (DR)

### 8.1 Spot Fleet Interruption Handling
- AWS issues a 2-minute Spot termination notice (`EC2 Spot Instance Interruption Warning`).
- **Automated Graceful Evacuation:**
  1. The node daemon traps the AWS CloudWatch interruption event.
  2. The worker marks itself as `DRAINING` in the internal registry and stops consuming new messages from SQS.
  3. Jobs currently in `VERIFYING` or `UPLOADING` are given 90 seconds to complete.
  4. Any incomplete transcoding job is returned to SQS via visibility timeout reset (`ChangeMessageVisibility` to 0), allowing a healthy peer node to immediately pick up the task.

### 8.2 Poison Pill Jobs & Dead-Letter Queue (DLQ)
- Malformed media files or corrupted streams could trigger FFmpeg segmentation faults or infinite loops.
- **Protection:**
  - Hard execution timeout: 120 seconds per job.
  - SQS Redrive Policy: `maxReceiveCount = 3`.
  - After 3 failed attempts, the job is permanently failed with error code `MEDIA_DECODE_ERROR` and directed to the Dead-Letter Queue (`muxaro-job-dlq`) for forensic inspection.
  - Quota rollback is automatically triggered so users are not penalized for infrastructure or stream decoding failures.

---

## 9. Capacity Verification & Load Testing Protocol

Prior to production sign-off, the infrastructure must be validated against the following test stages:
1. **Baseline Load (25k CCU):** 600 API RPS, 10 jobs/sec for 2 hours. Validate zero memory leaks in Fastify and Media Worker.
2. **Target Peak (100k CCU):** 2,500 API RPS, 35 jobs/sec for 4 hours. Confirm p99 latency < 120ms and queue wait time < 20s.
3. **Stress & Breakpoint Test:** Increment traffic by 10% every 10 minutes until API reaches saturation or queue backlog breaches 3,000. Confirm graceful degradation (HTTP 429 Too Many Requests with honest `Retry-After` headers, zero database crashes).
4. **Chaos Engineering Injection:**
   - Terminate 50% of active Spot media workers simultaneously. Verify queue recovery within 90 seconds without dropped jobs.
   - Inject simulated 200ms latency into PostgreSQL. Verify Fastify connection pool stability and read-replica failover.
