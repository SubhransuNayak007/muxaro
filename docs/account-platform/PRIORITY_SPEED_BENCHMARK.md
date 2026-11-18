# MUXARO Account Platform — Priority Speed Benchmark Report

This report documents the measured queue-wait and turnaround characteristics of MUXARO's 3-tier fair priority scheduler (`PREMIUM > REGISTERED > GUEST`) implemented in `apps/api/src/services/queue.service.ts` and exposed via `GET /api/v1/admin/metrics` (`priorityTiers`).

> For the full methodology, raw dispatch sequence, and IDOR verification details, see [`docs/performance/ACCOUNT_PRIORITY_BENCHMARK.md`](../performance/ACCOUNT_PRIORITY_BENCHMARK.md).

## Summary of Measured Contention Telemetry

Controlled burst of 12 simultaneous `480p` compression jobs (`video-transcoding` queue class, 2 active worker slots pre-saturated, `GUEST` submitted first and `PREMIUM` last):

| Account Tier | Weight | Max Concurrent / User | Queue Wait p50 | Queue Wait p95 | Processing p50 | Processing p95 | Completion Rate |
| :--- | :---: | :---: | ---: | ---: | ---: | ---: | :---: |
| **Premium** | `6` | `5` | `1,195 ms` | `2,611 ms` | `1,376 ms` | `1,475 ms` | `4 / 4 (100%)` |
| **Registered (Free)** | `3` | `2` | `4,041 ms` | `5,421 ms` | `1,259 ms` | `1,381 ms` | `4 / 4 (100%)` |
| **Guest** | `1` | `1` | `6,708 ms` | `8,062 ms` | `1,354 ms` | `1,618 ms` | `4 / 4 (100%)` |

## Honest Product Copy Guidance

- **Supported claim:** *"Signed-in accounts receive priority queue placement and higher concurrent job capacity during busy periods."*
- **Unsupported claim (prohibited):** Do **not** advertise fixed universal speed multipliers (e.g., *"3.5x faster downloads"*) because:
  1. When queues are idle, all tiers start immediately (`< 5 ms` queue wait).
  2. Actual FFmpeg encode duration is uniform across tiers (`~1.26–1.38s` p50 for the 2-second 1080p->480p benchmark clip); gains come honestly from shorter queue wait times under contention and higher per-user concurrency caps (`5` Premium vs `2` Registered vs `1` Guest).
  3. Anti-starvation aging (`+1` weight per `5s` waited, max `+12`) ensures Guests always make forward progress even under sustained load.
