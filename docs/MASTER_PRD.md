# VYRO
## MASTER PRODUCT REQUIREMENTS DOCUMENT (PRD)
### Software Architecture Document (SAD) + Technical Design Specification (TDS)

**Document version:** 1.0  
**Date:** 18 November 2026  
**Product codename:** VYRO (brand clearance pending)  
**Product category:** Media processing and authorised downloading SaaS  
**Target audience:** Product, design, frontend, backend, infrastructure, security and QA engineering teams  
**Execution environment:** Google Antigravity with a 10-specialist-agent engineering swarm  
**Document status:** Engineering baseline for implementation

---

# TABLE OF CONTENTS

1. Executive Summary
2. Product Vision and Objectives
3. Product Scope
4. Target Users and Personas
5. User Journeys
6. Functional Requirements
7. Non-Functional Requirements
8. Product Information Architecture
9. UI/UX Design Specification
10. Frontend Architecture
11. Backend Architecture
12. System Architecture and Diagrams
13. Media Processing Architecture
14. Source Integration Architecture
15. Playlist and Batch Architecture
16. Authentication and Authorisation
17. Quota and Credits Architecture
18. REST API Specification
19. Database Architecture
20. Storage Architecture
21. Messaging and Queue Architecture
22. Networking and Infrastructure Architecture
23. Scalability and Capacity Engineering
24. Security Architecture
25. Privacy and Compliance
26. SEO Architecture
27. Admin and Operations
28. Monitoring and Observability
29. Error Handling and Recovery
30. Performance Engineering
31. Testing Strategy
32. CI/CD and Deployment
33. Infrastructure as Code
34. Disaster Recovery
35. Ten-Agent Development Organisation
36. Implementation Roadmap
37. Acceptance Criteria
38. Risks and Mitigations
39. Definition of Done
40. Final Engineering Directives

---

# 1. EXECUTIVE SUMMARY

## 1.1 Product overview

VYRO is a modern, web-based media processing platform that provides a straightforward interface for inspecting, processing, converting and downloading authorised media.

The product combines:

- Media inspection.
- Video processing.
- Audio extraction.
- Audio conversion.
- Audio/video merging.
- Resolution selection.
- Playlist processing.
- Batch operations.
- Media conversion tools.
- User accounts.
- Usage limits.
- Credits and account history.
- Secure cloud processing.
- High-performance file delivery.

The primary user interaction is intentionally simple:

**Paste URL or upload file → Analyse → Choose options → Process → Download.**

Complexity should remain in the infrastructure, not the interface.

## 1.2 Product positioning

Position VYRO as a premium media utility with three characteristics:

1. Exceptional simplicity.
2. Dependable processing quality.
3. Fast, reliable delivery.

It should not look or behave like an advertisement-heavy downloader.

## 1.3 Core product principle

The system must distinguish between:

- Content inspection.
- File downloading.
- File conversion.
- Audio extraction.
- Stream copying.
- Video transcoding.
- Playlist orchestration.

These are different technical operations and must not be implemented as one generic download function.

## 1.4 Product platform constraint

The primary media pipeline supports user-uploaded files, user-owned content and media from integrations that explicitly permit the relevant operation.

YouTube integration may provide permitted metadata and official embedded-player functionality. Audiovisual downloading through YouTube integrations remains disabled unless the necessary written approval and legal review are obtained.

This is an architectural restriction, not something to work around using IP rotation, proxy switching, cookies or other access-control circumvention.

---

# 2. PRODUCT VISION AND OBJECTIVES

## 2.1 Vision

Create a globally accessible media utility capable of supporting 100,000 concurrent web sessions through an independently scalable frontend, backend, queue, worker and storage architecture.

This capacity goal must be measured through load testing. It must not be advertised as an achieved capability before verification.

## 2.2 Primary objectives

| Objective | Requirement |
|---|---|
| Simplicity | One primary media input |
| Speed | Fast analysis and job admission |
| Quality | Preserve source quality whenever possible |
| Formats | Multiple media output formats |
| Resolution | Up to genuine available 8K |
| Audio | Separate extraction and conversion |
| Merging | Combine separate video and audio files |
| Playlist | Batch playlist processing |
| Quotas | Ten individual jobs and one playlist job per rolling 24 hours |
| Scalability | 100K concurrent-session test target |
| Security | Isolated processing and strict access controls |
| SEO | Search-engine-friendly public pages |
| Reliability | Recoverable, observable asynchronous jobs |

---

# 3. PRODUCT SCOPE

## 3.1 MVP features — P0

These features are mandatory for the first production release.

- Responsive landing page.
- URL input.
- Secure file upload.
- Media inspection.
- Media metadata extraction.
- Video format selection.
- Audio format selection.
- Audio-only processing.
- Video-only processing.
- Audio/video merging.
- Media conversion.
- Asynchronous processing queue.
- Download delivery.
- User authentication.
- User dashboard.
- Daily limits.
- Playlist processing for authorised manifests and files.
- Job history.
- Documentation.
- Credits page.
- Administrative dashboard.
- Security protections.
- Monitoring.
- Error handling.

## 3.4 Explicitly out of scope

- Circumventing source-platform restrictions.
- Rotating proxy pools to avoid IP bans.
- CAPTCHA bypass.
- Account-cookie harvesting.
- Unauthorised platform extraction.
- Unlimited anonymous processing.
- Unlimited file sizes.
- Unbounded playlist jobs.

---

# 12. SYSTEM ARCHITECTURE AND STATE MACHINE

## 12.6 Job state machine

```text
CREATED --> VALIDATING --> QUEUED --> PROCESSING --> VERIFYING --> READY
                      \                                       \--> FAILED
                       \--> REJECTED
```

Cancellation flow: `QUEUED / PROCESSING --> CANCEL_REQUESTED --> CANCELLED`
Retry flow: `PROCESSING / VERIFYING --> RETRY_WAIT --> QUEUED`
Expiry flow: `READY --> EXPIRED`

Only verified output transitions a job to `READY`.

---

# 17. QUOTA AND CREDITS ARCHITECTURE

## 17.1 Default user entitlement

| Operation | Allowance |
|---|---:|
| Individual video jobs | 10 |
| Playlist jobs | 1 |
| Rolling window | 24 hours |
| Default playlist items | 50 |

The individual and playlist entitlements are independent.
Rolling 24-hour windows are evaluated dynamically in UTC, never reset at midnight.
Atomic reservation via DB transactions with outbox pattern.

---

# 18. REST API SPECIFICATION

Base path: `/api/v1`

Envelopes:
- Success: `{ "success": true, "data": {}, "requestId": "req_123" }`
- Error: `{ "success": false, "error": { "code": "QUOTA_EXCEEDED", "message": "...", "details": {} }, "requestId": "req_123" }`

Endpoints:
- `/auth/session`, `/auth/logout`, `/me`
- `/uploads`, `/uploads/:id`, `/uploads/:id/complete`
- `/media/inspect`, `/media/:id`
- `/jobs`, `/jobs/:id`, `/jobs/:id/cancel`, `/jobs/:id/retry`, `/jobs/:id/events`, `/jobs/:id/download`
- `/playlists/inspect`, `/playlists/jobs`, `/playlists/jobs/:id`, `/playlists/jobs/:id/items`, `/playlists/jobs/:id/package`
- `/entitlements`, `/entitlements/usage`, `/credits`, `/credits/ledger`
- `/history`, `/history/:id`
- `/admin/overview`, `/admin/users`, `/admin/jobs`, `/admin/queues`, `/admin/abuse`

---

# 19. DATABASE SCHEMA (POSTGRESQL)

Core entities:
- `users`: id, identity_provider, provider_subject, email, email_verified, display_name, account_status, timestamps
- `user_roles`: id, user_id, role, assigned_by, created_at
- `media_assets`: id, owner_user_id, source_type, source_reference, storage_key, original_filename, container, duration_seconds, file_size_bytes, video_codec, audio_codec, width, height, frame_rate, inspection_status, expires_at
- `media_streams`: id, media_asset_id, stream_index, stream_type, codec, bitrate, width, height, sample_rate, channels, metadata_json
- `processing_jobs`: id, owner_user_id, media_asset_id, job_type, status, priority, operation, options_json, idempotency_key, attempts, progress, error_code, timestamps
- `playlist_jobs`: id, owner_user_id, title, source_reference, status, total_items, completed_items, failed_items, cancelled_items, timestamps
- `playlist_items`: id, playlist_job_id, media_asset_id, processing_job_id, position, status, error_code
- `output_artifacts`: id, processing_job_id, storage_key, filename, mime_type, size_bytes, checksum, container, codec, duration_seconds, expires_at
- `entitlements`: id, user_id, entitlement_type, allowance, window_seconds, effective_from, effective_until
- `quota_reservations`: id, user_id, entitlement_type, job_id, status, reserved_at, consumed_at, released_at
- `credit_ledger`: id, user_id, transaction_type, amount, reference_type, reference_id, idempotency_key, created_at
- `audit_logs`: id, actor_user_id, action, resource_type, resource_id, request_id, ip_metadata, user_agent_metadata, details_json, created_at
- `outbox_events`: id, aggregate_type, aggregate_id, event_type, payload_json, published_at, created_at

---

# 24. SECURITY ARCHITECTURE

- Strict SSRF guard: Deny loopback (127.0.0.0/8, ::1), private IPv4 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local (169.254.0.0/16, fe80::/10), cloud metadata (169.254.169.254), DNS rebinding defense.
- FFmpeg command sanitization: Safe argument arrays only, no shell string interpolation, timeout and memory boundaries.
