# MUXARO User, Batch & Job Identifier Architecture
**Product:** MUXARO — *Your Media. One Powerful Workspace.*  
**Author:** AGENT 01 — Principal Architect & System Designer  
**Date:** 18 November 2026  

---

## 1. Design Philosophy: Separation of Internal & Public Identifiers

MUXARO strictly separates **internal relational primary keys** from **human-facing support identifiers**. Sequential auto-increment integers (`user_id = 42`, `job_id = 1091`) are forbidden on external APIs because they leak platform volume, enable trivial enumeration attacks, and fail under multi-region partitioning.

---

## 2. Canonical Identifier Registry

| Entity | Prefix / Format | Example | Storage & Generation | Exposure Scope |
| :--- | :--- | :--- | :--- | :--- |
| **Internal User ID** | `UUIDv7` (RFC 9562) | `01933ea8-7b2c-7f10-8a42-9c102e4b7d31` | 48-bit Unix ms timestamp + 74 bits CSPRNG (`crypto.randomBytes`) | Database PK/FK, internal joins, official GA4 `user_id` field (opaque, zero PII) |
| **Public User ID** | `MXR-` + 8 Base32 chars | `MXR-7K4P9W2M` | CSPRNG from 32-char Crockford-safe alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (excludes `0, O, 1, I, L`) | Account screen, support tickets, Admin search (`/admin/search?q=MXR-...`) |
| **Batch ID** | `MXB-YYYYMMDD-` + 6 Base32 chars | `MXB-20261118-4H9Q2X` | UTC date stamp + 30 bits CSPRNG | Batch & playlist tracking (`GET /api/v1/batches/:id`), Admin support lookup |
| **Batch Item Number** | 3-digit zero-padded string | `001`, `002`, `003` | Deterministic ordinal index per batch (`1..50`) | Item ordering in playlists, ZIP member prefixes, batch tables |
| **Job ID** | `MXJ-` + 10 Base32 chars | `MXJ-8F3N6T2W9R` | 50 bits CSPRNG from non-ambiguous Base32 alphabet | Processing status, My Downloads, download receipts, Admin search |
| **Reward Session ID** | `MXRWD-` + 10 Base32 chars | `MXRWD-5C8V2K9M4P` | 50 bits CSPRNG bound via HMAC `custom_data` to `user_id` | GAM SSV session tracking & replay verification |
| **Request ID** | `req_` + 16 hex chars | `req_a4f9c02e81b34d76` | 64 bits CSPRNG per HTTP request (`x-request-id` header) | API envelopes, error support correlation, Admin search |

---

## 3. Entropy & Collision Safety

- **Alphabet:** 32 visually unambiguous uppercase alphanumeric characters (`A–Z` minus `I, L, O` + `2–9`, 5 bits per character).
- **Public User ID (`MXR-` + 8 chars = 40 bits entropy):**
  - Space size: $32^8 = 1,099,511,627,776$ ($\approx 1.10 \times 10^{12}$).
  - By the birthday bound, collision probability reaches $0.001\%$ only after $\approx 4.7 \times 10^3$ concurrent inserts without unique check, and `UNIQUE(public_user_id)` in SQLite/PostgreSQL retries transparently on collision.
- **Job ID (`MXJ-` + 10 chars = 50 bits entropy):**
  - Space size: $32^{10} \approx 1.13 \times 10^{15}$, eliminating guesswork/enumeration while staying short enough to read over phone or chat support.
- **Internal User ID (`UUIDv7`):**
  - Monotonically time-ordered 48-bit millisecond prefix eliminates B-tree index page fragmentation in PostgreSQL/SQLite compared to random UUIDv4, while 74 bits of CSPRNG prevent guessing.

---

## 4. Security, Privacy & IDOR Rules

1. **Non-Guessability Is Not Authorization:** Even though `MXJ-` and `MXB-` carry 30–50 bits of entropy, **every protected endpoint MUST enforce explicit server-side owner verification**:
   - Authenticated requests: `record.ownerUserId === auth.user.id` (unless caller is an MFA-verified `admin` accessing `/api/v1/admin/*`).
   - Guest requests: `record.ownerUserId === null && record.guestId === auth.guestId`.
   - Mismatches return `403`/`404` and log a redacted `IDOR_ATTEMPT` row into `security_events`.
2. **Zero PII in Identifiers:** Neither `UUIDv7` nor `MXR-XXXXXXXX` encodes email, username, IP address, or registration order.
3. **GA4 `user_id` Boundary:**
   - Only the opaque internal `UUIDv7` is passed to Google Analytics `gtag('config', id, { user_id })` when the user is signed in and analytics consent is granted.
   - `user_id` is strictly reset to `null` upon logout.
   - Public IDs, emails, display names, URLs, and filenames are **never** sent to GA4.
4. **Account Deletion & Audit Continuity:** Soft-deleting a user (`DELETE /api/v1/me`) revokes all sessions immediately, marks `status = 'DELETED'`, anonymizes PII fields, and preserves immutable `credit_ledger` / `audit_logs` integrity referenced by opaque ID.
