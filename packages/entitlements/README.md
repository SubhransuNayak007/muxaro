# @muxaro/entitlements

> **MUXARO** — *Your Media. One Powerful Workspace.*  
> A powerful platform for authorised media downloading, processing and conversion.

Enterprise-grade TypeScript authentication, rolling 24-hour quota enforcement, two-phase atomic reservation with rollback, server-side idempotency, and transaction ledger engine for MUXARO.

## Core Features & Guarantees

1. **Free Tier Strict Enforcement**:
   - **Individual Video Jobs**: Exactly 10 jobs per rolling 24-hour window.
   - **Playlist Jobs**: Exactly 1 playlist job per rolling 24-hour window (with a hard cap of 50 items per job).
   - **Bucket Isolation**: Playlist jobs and individual video jobs operate in separate, isolated buckets. Playlist operations NEVER deplete individual video quotas, and child tasks (`PLAYLIST_CHILD`) consume zero independent video quota slots.

2. **Dynamic Rolling 24-Hour Sliding Window**:
   - Eliminates arbitrary midnight UTC resets.
   - Calculates the exact timestamp (`resetsAt`) and live countdown in seconds (`resetInSeconds`) when the earliest consumed slot frees up.

3. **Two-Phase Atomic Quota Reservation**:
   - **Phase 1 (Reserve)**: Atomically reserves a slot (`PENDING` / `RESERVED`) during job creation with automatic TTL expiration.
   - **Phase 2 (Commit)**: Marks quota as consumed (`COMMITTED` / `CONSUMED`) upon verified job completion.
   - **Phase 2 (Rollback)**: Automatically rolls back (`ROLLED_BACK` / `RELEASED`) on worker failure or user job cancellation, instantly restoring the user's available quota.
   - **Race-Condition Immune**: Concurrency-locked evaluation protects against parallel bursts.

4. **Server-Side Idempotency Protection**:
   - Guarantees network retries using the same `Idempotency-Key` never double-charge quotas or spawn duplicate jobs.
   - Detects and rejects conflicting payloads for the same idempotency key (`IDEMPOTENCY_CONFLICT`).

5. **Append-Only Transaction & Credit Ledger**:
   - Monotonically incrementing transaction log of every quota reservation, commitment, rollback, and credit grant/debit/refund.
   - Ready for future pay-as-you-go credit expansion.

6. **Session-Based Authentication & RBAC**:
   - Cryptographically signed HMAC-SHA256 session tokens.
   - Anonymous guest session support (IP/fingerprint bound).
   - Role hierarchy (`admin > pro > free > anonymous`) with granular permission checks.

---

## Installation & Import

```typescript
import {
  EntitlementsEngine,
  InMemoryEntitlementStore,
  POSTGRES_ENTITLEMENTS_SCHEMA,
  QuotaExceededError,
  PlaylistSizeExceededError,
} from '@muxaro/entitlements';
```

---

## Fastify API Integration Example

```typescript
import { EntitlementsEngine } from '@muxaro/entitlements';

const entitlements = new EntitlementsEngine();

// 1. Authenticate Request
fastify.addHook('preHandler', async (req, reply) => {
  const token = req.headers['authorization']?.replace('Bearer ', '') 
    || entitlements.sessions.parseCookieHeader(req.headers.cookie);

  if (token) {
    req.session = await entitlements.authenticateToken(token);
    req.user = entitlements.sessionToUser(req.session);
  } else {
    // Fallback to anonymous guest session
    const guest = await entitlements.createAnonymousSession(req.ip, req.headers['user-agent']);
    req.session = guest.session;
    req.user = entitlements.sessionToUser(guest.session);
  }
});

// 2. Submit Job with Atomic Quota Reservation & Idempotency
fastify.post('/api/v1/jobs', async (req, reply) => {
  const { url, jobType, itemCount = 1 } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];

  return entitlements.executeIdempotent(
    idempotencyKey,
    req.user.id,
    req.body,
    async () => {
      // Step A: Atomic Quota Reservation
      const reservation = await entitlements.reserveJobQuota({
        userId: req.user.id,
        userTier: req.user.tier,
        jobType,
        itemCount,
        idempotencyKey,
      });

      try {
        // Step B: Dispatch job to BullMQ queue
        const job = await mediaQueue.add(jobType, {
          url,
          reservationId: reservation.reservationId,
        });

        return {
          success: true,
          data: {
            jobId: job.id,
            reservationId: reservation.reservationId,
            status: 'QUEUED',
          },
        };
      } catch (enqueueError) {
        // Step C: Rollback immediately if enqueueing fails
        await entitlements.rollbackJobQuota(
          reservation.reservationId,
          'Failed to enqueue job to BullMQ'
        );
        throw enqueueError;
      }
    }
  );
});

// 3. User Cancels Job -> Immediate Quota Restore
fastify.post('/api/v1/jobs/:id/cancel', async (req, reply) => {
  const { id } = req.params;
  await mediaQueue.cancel(id);
  await entitlements.rollbackJobQuota(id, 'User cancelled job');
  return { success: true, message: 'Job cancelled and quota restored' };
});

// 4. Quota Dashboard
fastify.get('/api/v1/account/credits', async (req, reply) => {
  const summary = await entitlements.getQuotaSummary(req.user.id, req.user.tier, req.user.role);
  return {
    success: true,
    data: summary,
  };
});
```

---

## Verification & Test Results

Run all test suites:
```bash
npm test
```

Suite results:
```text
✔ Authentication & RBAC Engine (5 tests passed)
✔ Concurrency & Race-Condition Guard (20 parallel requests, 10 allowed, 10 blocked)
✔ Credit & Transaction Ledger Model (2 tests passed)
✔ Free Tier Quota Limits (3 tests passed)
✔ Server-Side Idempotency Key Engine (3 tests passed)
✔ Quota Bucket Isolation (2 tests passed)
✔ Atomic Quota Reservation & Rollback (4 tests passed)
✔ Rolling 24-Hour Sliding Window (3 tests passed)

Total: 23 passed, 0 failed, duration: ~1.1s
```
