# ADR-006: Entitlements, Quotas & Atomic Two-Phase Reservation Engine

**Status:** Accepted  
**Deciders:** Principal Architect (AGENT 01), Entitlements Engineer (AGENT 06), Backend Engineer (AGENT 03)  
**Date:** 2026-11-18  

---

## 1. Context and Problem Statement
To ensure sustainable multi-tenant operation, prevent denial-of-service (DoS) attacks on compute infrastructure, and provide fair access, MUXARO (formerly Project VYRO) enforces strict free-tier quotas:
1. **Individual Video Jobs:** Exactly 10 jobs per rolling 24-hour window.
2. **Playlist Jobs:** Exactly 1 playlist job per rolling 24-hour window (up to 50 items).
3. **Independent Quotas:** Processing a playlist must never deplete or decrement the user's individual video job allowance.

### The Race Condition Hazard:
In naive implementations, quota is checked via an in-memory counter or a standard non-atomic `SELECT count FROM jobs; if count < 10 then INSERT`. Under concurrent load (e.g. 10 simultaneous curl requests fired by an automated script), all 10 checks read `count = 0` simultaneously, admitting 10x the allowed quota.

Furthermore, if a job is admitted but fails due to worker timeout or is cancelled by the user, the user's quota would be unfairly lost unless an atomic rollback mechanism exists.

---

## 2. Decision
We implement a **Two-Phase Atomic Quota Reservation Engine** in `packages/entitlements/` backed by PostgreSQL ACID transactions:

### 2.1 The Two-Phase Lifecycle:
1. **Phase 1: Atomic Reservation (`RESERVED`)**
   - Evaluated during `POST /api/v1/jobs` admission inside a PostgreSQL serializable transaction with a row lock.
   - Sums all active reservations (`RESERVED`) plus completed jobs (`CONSUMED`) where `reserved_at >= NOW() - INTERVAL '24 hours'`.
   - If `count < allowance`, inserts a row into `quota_reservations` with status `'RESERVED'` and TTL = 1 hour.
   - If `count >= allowance`, rejects the request with HTTP 409 `ERR_QUOTA_EXCEEDED` and returns the exact millisecond countdown until the earliest slot expires.
2. **Phase 2: Permanent Consumption or Release**
   - **On Success (`READY`):** Transition reservation status to `'CONSUMED'`, setting `consumed_at = CURRENT_TIMESTAMP`.
   - **On Failure or Cancellation (`FAILED` / `CANCELLED`):** Transition reservation status to `'RELEASED'`, setting `released_at = CURRENT_TIMESTAMP`. The user's slot is immediately freed.

### 2.2 Independent Rolling 24-Hour Windows
- Quotas are evaluated dynamically in UTC relative to `CURRENT_TIMESTAMP - INTERVAL '24 hours'`.
- There are no arbitrary midnight resets. Slots free up exactly 24 hours after each respective job was reserved.
- The `INDIVIDUAL_VIDEO_JOB` and `PLAYLIST_JOB` entitlement types are tracked in discrete partitions in `quota_reservations`. Child tasks spawned by a playlist job carry `entitlement_type = 'PLAYLIST_CHILD'` and are bounded by the playlist allowance, leaving the user's 10 individual video slots untouched.

### 2.3 Server-Side Idempotency Keys
- Every state-mutating request requires an `idempotencyKey` header or payload field (UUID or client-generated hash).
- If a client retries a network request with the same idempotency key, the API Gateway returns the existing job status without creating a duplicate job or reserving additional quota.

### 2.4 Immutable Credit Ledger
- For future monetization (Pro tiers, pay-as-you-go credit packs), all quota adjustments and credit deductions are recorded in an append-only `credit_ledger` table. In-place balance mutations without ledger entries are forbidden.

---

## 3. Consequences

### Positive:
- 100% immune to concurrent submission race conditions.
- Zero lost user quota on worker failures or user cancellations.
- Completely transparent to users: the UI can display exact live countdown timers for when each slot frees up.
- Enforces strict independence between playlist jobs and individual video jobs.

### Negative:
- Slightly higher database write volume per job (one insert on reservation, one update on completion). Mitigated by composite B-tree indexes and lean row size.
