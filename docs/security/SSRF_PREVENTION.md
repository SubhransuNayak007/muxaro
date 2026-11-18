# MUXARO SSRF Prevention Architecture

**Primary Implementations:**
- `security/src/ssrf-guard.ts` (`validateUrlForSsrf`, `safeFetch`, `isBlockedIpv4`, `isBlockedIpv6`, `parseObfuscatedIpv4`)
- `packages/source-adapters/src/ssrf-filter.ts` (Adapter-level self-contained SSRF filter)
- `tests/security/ssrf-regression.test.ts` (69 automated SSRF regression tests)
- `security/tests/ssrf.test.ts` & `packages/source-adapters/tests/ssrf-filter.test.ts`

---

## 1. Why SSRF Is a Critical Threat for MUXARO

Because MUXARO accepts user-supplied media URLs for inspection (`POST /api/v1/media/inspect`) and job processing (`POST /api/v1/jobs`, `POST /api/v1/playlists/process`), an unprotected server could be coerced into probing internal RFC 1918 networks, container control planes (Docker/Kubelet/Redis/PostgreSQL), or cloud Instance Metadata Services (AWS/GCP/Azure IMDS).

MUXARO blocks SSRF at **two independent layers**: before external inspection in `packages/source-adapters`, and prior to any outbound fetch or media job execution via `@vyro/security` (`security/src/ssrf-guard.ts`).

---

## 2. Multi-Stage Validation Pipeline (`validateUrlForSsrf`)

Every external URL passes through six sequential security gates before any network socket is opened:

```mermaid
flowchart LR
    URL["Untrusted Input URL"] --> P1["1. Scheme Allowlist\n(http:, https: only)"]
    P1 --> P2["2. Port Guard\n(default: 80, 443;\n30+ internal ports blocked)"]
    P2 --> P3["3. Userinfo Rejection\n(no user:pass@host)"]
    P3 --> P4["4. Hostname Normalization\n(percent-decode, IDN fullwidth\ndots, metadata blocklist)"]
    P4 --> P5["5. Obfuscated IP & CIDR Check\n(decimal, hex, octal, IPv6,\n::ffff: IPv4-mapped)"]
    P5 --> P6["6. DNS Resolution & IP Pinning\n(validate ALL A/AAAA records,\npin first safe IP for socket)"]
    P6 --> Fetch["safeFetch() with pinned IP\n+ TLS SNI + Redirect Re-Validation"]
```

### Stage 1: Protocol Allowlist
- Permits strictly `http:` and `https:` by default.
- Rejects `file://`, `ftp://`, `gopher://`, `dict://`, `data:`, `javascript:`, and custom schemes (`reason: 'FORBIDDEN_PROTOCOL'`).

### Stage 2: Port Restrictions
- Default `allowedPorts`: `[80, 443]`.
- `BLOCKED_PORTS` explicitly denies sensitive internal service ports including FTP (`20, 21`), SSH (`22`), Telnet (`23`), SMTP (`25, 465, 587`), DNS (`53`), SMB (`445`), MSSQL (`1433`), Oracle (`1521`), NFS (`2049`), Docker (`2375, 2376`), MySQL (`3306`), RDP (`3389`), PostgreSQL (`5432`), CouchDB (`5984`), Redis (`6379`), Consul (`8500`), MinIO (`9000`), Prometheus (`9090`), Elasticsearch (`9200, 9300`), Memcached (`11211`), and MongoDB (`27017, 27018`).

### Stage 3: Embedded Credential Rejection
- Any URL containing `username` or `password` (`http://user:pass@host`) is rejected (`reason: 'USERINFO_REJECTED'`) to defeat URL-parser confusion attacks (`http://public.com@127.0.0.1/`).

### Stage 4: Hostname Normalization & Cloud Metadata Blocklist
- `normalizeHostname()` percent-decodes the host, replaces fullwidth/ideographic Unicode dots (`\u3002`, `\uFF0E`, `\uFF61`) with `.`, strips IPv6 brackets and trailing dots, and lowercases.
- `BLOCKED_HOSTNAMES` explicitly blocks:
  - `169.254.169.254`, `fd00:ec2::254`
  - `metadata.google.internal`, `metadata.goog`, `metadata`, `instance-data`
  - `localhost`, `ip6-localhost`, `ip6-loopback`

### Stage 5: IPv4, IPv6 & Obfuscated IP Filtering
- **Obfuscated IPv4 Parser (`parseObfuscatedIpv4`):** Decodes decimal integers (`2130706433` → `127.0.0.1`), hexadecimal (`0x7f000001`), octal (`0177.0.0.1`), and abbreviated dotted forms (`127.1`, `10.0.1`) before CIDR evaluation.
- **Blocked IPv4 CIDRs (`BLOCKED_IPV4_RANGES`):**
  - `0.0.0.0/8` (Current Network), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 Private)
  - `100.64.0.0/10` (CGNAT), `127.0.0.0/8` (Loopback), `169.254.0.0/16` (Link-Local / Cloud Metadata)
  - `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`
  - `224.0.0.0/4` (Multicast), `240.0.0.0/4` (Reserved), `255.255.255.255/32` (Broadcast)
- **Blocked IPv6 Ranges (`isBlockedIpv6`):**
  - Unspecified (`::`), Loopback (`::1`), Unique Local (`fc00::/7`), Link-Local (`fe80::/10`), Multicast (`ff00::/8`), Documentation (`2001:db8::/32`), Discard-Only (`100::/64`).
  - **De-encapsulation:** Unwraps IPv4-mapped IPv6 (`::ffff:127.0.0.1`), deprecated IPv4-compatible (`::/96`), and 6to4 (`2002::/16`) prefixes and re-evaluates the embedded IPv4 address against `BLOCKED_IPV4_RANGES`.

### Stage 6: DNS Rebinding Mitigation & Redirect Re-Validation (`safeFetch`)
1. Resolves **all** `A` and `AAAA` DNS records via `dns.lookup(normalizedHost, { all: true })`. If *any* returned record maps to a restricted IP, the entire request is rejected (`DNS_RESOLVED_BLOCKED_IP`).
2. **Socket IP Pinning:** `safeFetch()` connects directly to `check.pinnedIp` while setting the `Host` header to `parsed.host` and `servername: parsed.hostname` (for TLS SNI and certificate validation), eliminating the Time-of-Check-to-Time-of-Use (TOCTOU) DNS rebinding window.
3. **Safe Redirect Chasing:** Follows up to `maxRedirects` (default `5`), resolving relative `Location` headers and re-running the full `validateUrlForSsrf()` check on **every** redirect hop.

---

## 3. Verification & Regression Suite

Run the SSRF unit and regression suites locally:

```bash
# 69-case SSRF regression suite
npx tsx --test tests/security/ssrf-regression.test.ts

# Security package unit tests
node --experimental-strip-types security/tests/ssrf.test.ts

# Source adapter SSRF filter tests
cd packages/source-adapters && npm run test:ssrf
```
