# ADR-002: Distributed Queue Architecture — Redis BullMQ with PostgreSQL Transactional Outbox

**Status:** Accepted  
**Deciders:** Principal Architect (AGENT 01), Backend Engineer (AGENT 03), SRE (AGENT 07)  
**Date:** 2026-11-18  

---

## 1. Context and Problem Statement
Media processing operations (transcoding 4K video, remuxing large audio streams, packaging 50-item playlists into ZIP archives) are compute-heavy and can run from several seconds to multiple minutes. Handling these within synchronous HTTP request-response cycles causes connection timeouts, resource starvation, and inability to scale horizontally.

The system requires an asynchronous queue engine that satisfies:
1. Sub-millisecond enqueue and dispatch latency.
2. Robust stalled job detection and automatic worker crash recovery.
3. Native parent-child job orchestration for playlists (deconstructing 1 playlist into up to 50 concurrent child stream jobs).
4. Real-time progress broadcasting (0-100%) and instant cancellation propagation.
5. Strict zero-loss durability—no enqueued job or reserved quota may disappear if a cache node crashes.

---

## 2. Alternatives Considered

1. **In-Memory Local Event Queue (EventEmitter / async.queue):**
   - *Verdict: Rejected.* Desktop-style anti-pattern. Fails completely in multi-instance horizontal deployments; unrecoverable upon container restart.
2. **Pure PostgreSQL Queue (`pg-boss` / `SKIP LOCKED` polling):**
   - *Verdict: Rejected for High Throughput.* Polling PostgreSQL creates excessive table bloat, write amplification on `VACUUM`, and high connection contention under 100K concurrent sessions. Lacks native sub-millisecond Pub/Sub for SSE streaming.
3. **AWS SQS / GCP Cloud Tasks:**
   - *Verdict: Rejected as Primary Local Dev / Core Engine.* Lacks native local development ergonomics, lacks native parent-child workflow dependency graphs, and introduces vendor lock-in.
4. **Redis 7 + BullMQ paired with PostgreSQL Transactional Outbox:**
   - *Verdict: Accepted.* Combines the in-memory speed, flow graphs, and Pub/Sub of BullMQ with the ACID durability and audit trail of PostgreSQL.

---

## 3. Decision
We adopt **Redis 7 Cluster running BullMQ** as the operational execution queue, paired with **PostgreSQL 16 using the Transactional Outbox Pattern**:

1. **Transactional Outbox for Guaranteed Admission:**
   - The API Gateway reserves quota and creates the job record in PostgreSQL within an ACID transaction.
   - An `outbox_events` record is inserted atomically in the same database transaction.
   - A lightweight outbox relay process reads pending outbox events and pushes them into BullMQ.
2. **BullMQ Queues:**
   - `muxaro:media:transcode` (High CPU concurrency: 2 per node).
   - `muxaro:media:stream-copy` (I/O bound, high concurrency: 8 per node).
   - `muxaro:playlist:orchestrator` (Parent flow coordinator: maps and tracks child items).
3. **Cancellation & Progress via Redis Pub/Sub:**
   - Workers publish monotonic progress updates to channel `job:progress:{jobId}`.
   - Fastify API subscribes and pipes events directly to client HTTP Server-Sent Events (SSE).
   - Cancellation requests publish to `job:cancel:{jobId}`, immediately signaling the worker to kill the child FFmpeg process.

---

## 4. Consequences

### Positive:
- High throughput: Capable of handling thousands of job status transitions per second without database lock contention.
- Zero lost jobs: Even if Redis experiences a restart, uncommitted or dropped jobs are recovered from the PostgreSQL outbox.
- Native playlist dependency resolution via BullMQ FlowProducer.
- Built-in stalled job detection and configurable exponential backoff retry.

### Negative:
- Requires maintaining both Redis and PostgreSQL in infrastructure manifests.
- Requires the outbox relay process to prevent dual-write drift.
