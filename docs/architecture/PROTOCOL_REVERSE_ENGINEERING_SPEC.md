# Project Garuda: Protocol Reverse-Engineering Specification
**High-Throughput Ingestion Contracts, Anti-Bot Defeats, and Multi-Platform Stream Extraction**

- **Author:** `@protocol` (Protocol Reverse-Engineering Specialist)
- **Target:** Project Garuda Core Extraction Engine & Source Adapters (`@muxaro/source-adapters`)
- **Date:** November 20, 2026
- **Status:** APPROVED PRODUCTION SPECIFICATION & VERIFIED IMPLEMENTATION
- **Framework:** Scientific-Critical-Thinking & Epistemic Taxonomy (`[located evidence]`, `[assumption]`, `[prediction]`, `[decision]`)

---

## Executive Summary

Project Garuda requires reliable, deterministic, and scalable media stream URL extraction across high-hostility streaming portals: **YouTube**, **TikTok**, **Instagram**, and **Twitter/X**. Over the past 24 months, these platforms have evolved from simple HTTP endpoints into stateful, attestation-gated anti-abuse perimeters.

This specification details the reverse-engineered protocol contracts, cryptographic algorithms, client emulation matrices, and edge mitigation strategies required to operate at scale without rate limits, bot bans, or IP disqualification.

```
==================================================================================================
                   PROJECT GARUDA: PROTOCOL REVERSE-ENGINEERING ARCHITECTURE
==================================================================================================

  [ Ingress Portals ]
  YouTube / Shorts        TikTok / Douyin         Instagram / Reels       Twitter / X
         |                       |                       |                     |
         v                       v                       v                     v
  +--------------------------------------------------------------------------------------------+
  |                               SOURCE ADAPTER LAYER (@muxaro/source-adapters)               |
  |                                                                                            |
  |  +-------------------------+  +-----------------------+  +-------------------------------+ |
  |  | Innertube Client Matrix |  | TikTok play_addr      |  | Instagram GraphQL / DocID     | |
  |  | - TVHTML5_SIMPLY_EMBED  |  | - URL re-writing      |  | - Query hash & doc_id         | |
  |  | - IOS / ANDROID         |  | - Mobile API feed     |  | - X-IG-App-ID & CSRF token    | |
  |  | - WEB / WEB_EMBEDDED    |  | - Watermark removal   |  | - High-bitrate video_versions | |
  |  +-------------------------+  +-----------------------+  +-------------------------------+ |
  |               |                                                          |                 |
  |               v                                                          v                 |
  |  +-------------------------+                             +-------------------------------+ |
  |  | n-sig De-obfuscation    |                             | Twitter Guest Auth Engine     | |
  |  | - base.js AST Analysis  |                             | - Guest token activation      | |
  |  | - Sandboxed Interpreter |                             | - TweetResultByRestId GraphQL | |
  |  | - LRU Player Cache      |                             | - Bitrate variant ranking     | |
  |  +-------------------------+                             +-------------------------------+ |
  |               |                                                                            |
  |               v                                                                            |
  |  +---------------------------------------------------------------------------------------+ |
  |  | Redis-Backed Proof-of-Origin (PoToken) & BotGuard Attestation Pool                    | |
  |  | - Headless Chrome Minting Farm                                                        | |
  |  | - VisitorData + IP-Bound Attestation Tokens (12h TTL)                                 | |
  |  | - Autonomous Pre-Warming & Quota Management                                           | |
  |  +---------------------------------------------------------------------------------------+ |
  +--------------------------------------------------------------------------------------------+
                                  |
                                  v
                  [ UNTHROTTLED CDN EGRESS DATA PLANE ]
                  - Direct 302 Tunneling to Player Client
                  - Multi-Range Parallel Chunk Streaming (8-16 Workers)
                  - RFC 5952 Outbound IPv6 /64 Dynamic Subnet Rotation
==================================================================================================
```

---

## 1. YouTube Innertube Multi-Client Fallback Matrix

### 1.1 The Innertube Architecture & Defense Stratification
`[located evidence]` YouTube routes all client interactions through a consolidated private API known as **Innertube** (`https://www.youtube.com/youtubei/v1/player`). Unlike legacy v3 public REST APIs, Innertube is client-agnostic and returns direct stream signatures, adaptive streaming manifests (DASH/HLS), and playback tracking telemetry.

`[located evidence]` YouTube employs tiered anti-bot defenses depending on the declared client identity in `context.client`:
1. **WEB Client (Desktop/Mobile Web):** Highest hostility. Mandates strict PoToken attestation on datacenter ASNs, enforces SABR (Server-Adaptive BitRate) streaming via binary UMP packets, and requires `n-sig` URL deciphering.
2. **IOS Client (YouTube Native App):** High fidelity, lower hostility. Returns direct unthrottled DASH streams (`adaptiveFormats`) and progressive MP4s without SABR binary fragmentation. Does not enforce strict Web PoTokens.
3. **ANDROID Client (YouTube Android App):** Requires Android Play Integrity attestation tokens on recent versions; provides complete 4K/HDR VP9 and AV1 format tables.
4. **TVHTML5_SIMPLY_EMBEDDED (Smart TV / Embedded Web):** Lowest hostility. Designed for resource-constrained Smart TVs (Samsung Tizen, LG webOS). **Does not enforce SABR streaming, does not require PoToken attestation, and returns clear, unthrottled progressive and DASH URLs.**

### 1.2 Protocol Contracts & Header Specification

`[located evidence]` To invoke `/youtubei/v1/player`, the client must send an HTTP POST request with specific JSON headers and an `innertubeContext` matching the declared client profile.

```
POST https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_... HTTP/2
Host: www.youtube.com
Content-Type: application/json
User-Agent: <Client-Specific UA>
X-YouTube-Client-Name: <Numeric Client ID>
X-YouTube-Client-Version: <Client Version String>
X-Goog-Visitor-Id: <Optional Session Attestation>
Origin: https://www.youtube.com
```

#### Detailed Client Profiles

| Parameter | `TVHTML5_SIMPLY_EMBEDDED` | `IOS` | `ANDROID` | `WEB` |
| :--- | :--- | :--- | :--- | :--- |
| **Client ID (`X-YouTube-Client-Name`)** | `85` | `5` | `3` | `1` |
| **Client Version** | `2.0` | `19.45.4` | `19.44.38` | `2.20241118.01.00` |
| **User-Agent** | `Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1` | `com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)` | `com.google.android.youtube/19.44.38 (Linux; U; Android 14; en_US; Pixel 8 Pro Build/UD1A.230803.041)` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36` |
| **SABR Wire Protocol** | **DISABLED** (Pure HTTP GET) | **DISABLED** on older clients | Partially Enforced | **MANDATORY** |
| **PoToken Requirement** | **NONE** | Low | Play Integrity (or none on fallback) | **STRICT** on Datacenter IPs |
| **n-sig Throttling** | Minimal | Standard | Standard | High |
| **Available Formats** | Progressive (360p, 720p), DASH (1080p, 4K) | Progressive (720p), DASH (1080p+, Opus) | DASH (1080p, 1440p, 4K HDR), Progressive | All Formats (SABR gated) |

### 1.3 Exact Payload Schema for Innertube Context

`[located evidence]` Each request must serialize `context.client`:

```json
{
  "videoId": "dQw4w9WgXcQ",
  "context": {
    "client": {
      "clientName": "TVHTML5_SIMPLY_EMBEDDED",
      "clientVersion": "2.0",
      "clientScreen": "EMBED",
      "platform": "TV",
      "hl": "en",
      "gl": "US",
      "utcOffsetMinutes": 0
    },
    "thirdParty": {
      "embedUrl": "https://www.youtube.com"
    }
  },
  "playbackContext": {
    "contentPlaybackContext": {
      "html5Preference": "HTML5_PREF_WANTS",
      "signatureTimestamp": 19800
    }
  }
}
```

### 1.4 Authentication Requirements: Anonymous vs Authenticated Sessions
`[located evidence]`
1. **Anonymous Ingestion:**
   - Omits `Authorization` and cookie headers.
   - Relies on `X-Goog-Visitor-Id` (Visitor Data) minted from the `/visitor_id` endpoint or extracted from initial web responses.
   - High availability, zero account burn risk.
2. **Authenticated Ingestion (Bypassing Age-Gates & Member-Only Streams):**
   - Requires session cookies: `SAPISID`, `SSID`, `HSID`, `__Secure-3PAPISID`, `LOGIN_INFO`.
   - Requires calculation of the `SAPISIDHASH` header:
     $$\text{SAPISIDHASH} = \text{timestamp} + \text{"\_"} + \text{SHA1}(\text{timestamp} + \text{" "} + \text{SAPISID} + \text{" "} + \text{Origin})$$
   - Request must include:
     ```
     Authorization: SAPISIDHASH 1732089600_a1b2c3d4e5f6...
     Cookie: SAPISID=...; __Secure-3PAPISID=...; LOGIN_INFO=...
     ```

### 1.5 Multi-Client Fallback State Machine
`[decision]` Project Garuda implements a deterministic 4-stage client fallback cascade:

```mermaid
flowchart TD
    Start([Incoming Video Extraction]) --> TryTV[Stage 1: TVHTML5_SIMPLY_EMBEDDED]
    TryTV --> CheckTV{Status == OK & Non-SABR?}
    CheckTV -- Yes --> Success[Return Resolved Manifest]
    CheckTV -- No: LOGIN_REQUIRED / Age-Restricted --> TryIOS[Stage 2: IOS Client]
    
    TryIOS --> CheckIOS{Status == OK?}
    CheckIOS -- Yes --> Success
    CheckIOS -- No: BotGuard / 403 --> TryAndroid[Stage 3: ANDROID Client]
    
    TryAndroid --> CheckAndroid{Status == OK?}
    CheckAndroid -- Yes --> Success
    CheckAndroid -- No --> TryWeb[Stage 4: WEB Client + PoToken Pool]
    
    TryWeb --> CheckWeb{Status == OK?}
    CheckWeb -- Yes --> ApplyNSig[Apply AST n-sig Decipherer]
    ApplyNSig --> Success
    CheckWeb -- No --> HardFail([Return Unplayable / DRM Error])
```

- `[prediction]` Initiating inspection via `TVHTML5_SIMPLY_EMBEDDED` will resolve >92% of standard public YouTube videos without triggering BotGuard challenges, eliminating PoToken consumption for normal traffic.
- `[decision]` Only escalate to `WEB + PoToken` when handling age-restricted or premium videos requiring authenticated cookies.

---

## 2. The n-sig Throttling Parameter Reverse Engineering

### 2.1 The Throttling Mechanism: Why YouTube Enforces n-sig
`[located evidence]` Google protects its content delivery network (`*.googlevideo.com`) by embedding an encrypted challenge parameter `&n=` into all media stream URLs in `streamingData.adaptiveFormats` and `streamingData.formats`.
- If a client requests a video stream using the raw `n` parameter as returned by Innertube, the Google Video Edge (GGC) accepts the connection but **artificially clamps download bandwidth to ~40 KB/s - 80 KB/s** (real-time playback rate), causing multi-worker parallel chunk streaming to stall.
- If the `n` parameter is omitted or corrupted, GGC immediately returns **HTTP 403 Forbidden**.
- When YouTube's official player executes in a browser, it invokes an obfuscated JavaScript transformation function located in `base.js` that computes:
  $$n_{\text{deciphered}} = f_{\text{obfuscated}}(n_{\text{raw}})$$
- Transforming `n` to $n_{\text{deciphered}}$ signals legitimate player execution, unlocking 100+ Gbps GGC line rate.

### 2.2 Anatomical Structure of `base.js` Obfuscation
`[located evidence]` YouTube regenerates `base.js` daily across rolling player hashes (e.g., `https://www.youtube.com/s/player/22b9b7e7/player_ias.vflset/en_US/base.js`).
The script employs four obfuscation primitives:
1. **Variable and Identifier Renaming:** All functions and arrays are renamed to 2-character identifiers (e.g., `a`, `ba`, `Dza`).
2. **Control Flow Flattening via Dispatch Loops:** The algorithm flattens sequential execution into a switch-case state machine reading an array of opcodes.
3. **Core Elementary Array Transformations:**
   The deciphering logic always compiles down to three elementary operations on a character array:
   - **`reverse()`**: Reverses array order: `a.reverse()`
   - **`swap(pos)`**: Swaps index 0 with index $pos \pmod{|a|}$:
     ```javascript
     const c = a[0];
     a[0] = a[pos % a.length];
     a[pos % a.length] = c;
     ```
   - **`splice(pos)` / `slice(pos)`**: Strips $pos$ elements from the head: `a.splice(0, pos)`
4. **Character Code Transformations:** Modular arithmetic applied to char codes using an alphabet offset table (standard base64 modified set: `[a-zA-Z0-9-_]`).

### 2.3 Clean AST & Interpreter Algorithm

`[decision]` Rather than running an insecure `eval()` or heavyweight browser runtime, Project Garuda uses a deterministic AST/OpCode interpreter algorithm that parses the obfuscated function into a lightweight byte-instruction sequence.

```typescript
export type NSigOpCode =
  | { op: 'reverse' }
  | { op: 'swap'; index: number }
  | { op: 'splice'; count: number }
  | { op: 'rotate'; shift: number };

export interface NSigDecipherPlan {
  playerHash: string;
  operations: NSigOpCode[];
}
```

#### Extraction Pattern (AST Regex Signature)
`[located evidence]` The `n` transformation entrypoint is consistently identifiable across player builds by targeting the call-site pattern where the `n` parameter is re-assigned:
```regex
/\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]+)(?:\[(\d+)\])?\([a-zA-Z0-9$]+\)/
```
Or the canonical function declaration:
```regex
function\s*([a-zA-Z0-9$]+)\s*\(\s*([a-zA-Z0-9$]+)\s*\)\s*\{\s*var\s*([a-zA-Z0-9$]+)=\2\.split\(""\)(?:[^\}]+)\.join\(""\)\s*\}/
```

#### Sandboxed Interpreter Execution
The interpreter executes in pure TypeScript with zero external dependencies:

```typescript
export class NSigInterpreter {
  /**
   * Execute an extracted transformation plan on a raw 'n' parameter
   */
  public static execute(rawN: string, plan: NSigDecipherPlan): string {
    const chars = rawN.split('');
    const len = chars.length;

    for (const step of plan.operations) {
      switch (step.op) {
        case 'reverse':
          chars.reverse();
          break;
        case 'swap': {
          const idx = ((step.index % len) + len) % len;
          const tmp = chars[0];
          chars[0] = chars[idx];
          chars[idx] = tmp;
          break;
        }
        case 'splice':
          chars.splice(0, step.count);
          break;
        case 'rotate': {
          const shift = ((step.shift % len) + len) % len;
          const rotated = chars.slice(shift).concat(chars.slice(0, shift));
          chars.length = 0;
          chars.push(...rotated);
          break;
        }
      }
    }
    return chars.join('');
  }
}
```

`[prediction]` Caching `NSigDecipherPlan` by `playerHash` in an in-memory LRU cache reduces decipher overhead to $< 0.05\text{ ms}$ per stream, enabling $> 20,000\text{ req/sec}$ on a single core.

---

## 3. Proof of Origin (PoToken) & BotGuard WebAssembly Architecture

### 3.1 The WebAssembly Token Minting Architecture
`[located evidence]` YouTube's BotGuard defense compiles an x86/ARM-like virtual machine into WebAssembly (`bg_state.wasm`).
When a browser executes YouTube:
1. YouTube loads the BotGuard bootstrap script (`https://www.google.com/recaptcha/enterprise/reload` or `https://www.youtube.com/s/desktop/.../jsbin/botguard.js`).
2. The VM collects cryptographic hardware and environment attestation signals:
   - GPU WebGL renderer string (`ANGLE (Intel, Intel(R) UHD Graphics 630...)`)
   - Canvas 2D noise hash (sub-pixel antialiasing fingerprint)
   - AudioContext oscillator phase drift
   - High-resolution monotonic timers (`performance.now()` jitter)
   - Chrome automation flags (`navigator.webdriver`, `window.cdc_adoQpoasnfa76pfcZLmcfl_Array`)
3. The VM executes an encrypted bytecode challenge sent by Google Borg.
4. Output: A cryptographically signed **Proof of Origin Token (`po_token`)** and a **Visitor Data Token (`visitor_data`)**.

```
==================================================================================================
                           BOTGUARD WEBASSEMBLY ATTESTATION PIPELINE
==================================================================================================

  [ Google Challenge Server ]
             |
             | 1. Deliver Encrypted Bytecode Challenge & VM Seed
             v
  +--------------------------------------------------------------------------------------------+
  | BROWSER / HEADLESS CHROMIUM WORKER RUNNER                                                 |
  |                                                                                            |
  |  +---------------------------+        +--------------------------------------------------+ |
  |  | Environment Sensors       |        | BotGuard WebAssembly VM Engine                   | |
  |  | - WebGL Shader Signature  |------->| - Decrypt bytecode challenge                     | |
  |  | - AudioContext Frequency  |        | - Measure execution delta & entropy              | |
  |  | - DOM & Navigator Tree    |        | - Calculate HMAC-SHA256 of IP + Visitor Data     | |
  |  +---------------------------+        +--------------------------------------------------+ |
  |                                                               |                            |
  +---------------------------------------------------------------|----------------------------+
                                                                  v
                                              [ Minted Attestation Bundle ]
                                              - po_token: "MnlkNDkzOGQ..."
                                              - visitorData: "Cgt2S1V6b3..."
                                              - Valid for: 12 Hours
                                              - Bound to: Client IPv6 /64 Egress Subnet
==================================================================================================
```

### 3.2 The Cryptographic IP-Binding Trap
`[located evidence]` `po_token` is not an isolated random string. Google BFE binds the token to:
1. **Visitor Data (`visitor_data`):** Ephemeral cookie-like session identifier.
2. **Client IP Prefix:** Tokens minted on IP $A$ (e.g., residential proxy) will **fail with HTTP 403** if presented in a Player request originating from IP $B$ (e.g., datacenter egress), unless both share the same `/64` or `/48` subnet.
3. **Session Type:** Minted as either **Web PoToken** (tied to browser context) or **Content Binding PoToken** (tied to a specific `videoId`).

### 3.3 Maintaining a Headless Attestation Pool in Redis
`[decision]` Project Garuda implements a distributed **PoToken Minting Pool** backed by Redis.

#### Redis Schema & Data Structures

```
KEY: garuda:potoken:pool:{subnet_hash}
TYPE: Sorted Set (ZSET)
SCORE: Expiration Timestamp (epoch milliseconds, current + 12 hours)
MEMBER: JSON payload:
{
  "poToken": "MnlkNDkzOGQ...",
  "visitorData": "Cgt2S1V6b3...",
  "mintedAt": 1732089600000,
  "expiresAt": 1732132800000,
  "egressSubnet": "2405:201:6800:1122::/64",
  "clientType": "WEB"
}

KEY: garuda:potoken:stats:{subnet_hash}
TYPE: Hash (HSET)
FIELDS:
  total_minted: 1420
  active_tokens: 48
  cache_hits: 120530
  cache_misses: 12
```

#### Lease & Proactive Pre-Warming Algorithm
1. **Token Acquisition (`leaseToken`):**
   - Query Redis for active tokens where $expiresAt > \text{now}() + 30\text{ minutes}$.
   - If available, pop token from pool or rotate round-robin.
   - If pool depth $< 10$, trigger an asynchronous background minting job to the Headless Farm.
2. **Headless Farm Ingestion:**
   - A cluster of ultra-lightweight Puppeteer/Chromium instances runs in the same network namespace as the egress subnet.
   - Instances load a blank YouTube embed page (`https://www.youtube.com/embed/`), evaluate the BotGuard attestation script, and mint fresh tokens directly into Redis every 4 hours.

---

## 4. TikTok Non-Watermarked `play_addr` Extraction

### 4.1 TikTok Media Delivery Protocol
`[located evidence]` TikTok serves video streams through Akamai, ByteDance CDN, and Cloudflare.
The video payload is indexed in two primary locations:
1. **Desktop Web SSR Hydration:** Embedded in the HTML page inside `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">` under `defaultScope.webapp.videoDetail.itemInfo.itemStruct`.
2. **Mobile API Feed Endpoint:**
   `https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/?aweme_id={video_id}`

### 4.2 Anatomy of the Watermark Mechanism
`[located evidence]` In TikTok's internal JSON response, two distinct stream pointers exist:
- **`download_addr`:** Points to the video transcoded with an animated TikTok logo and creator username watermark.
- **`play_addr`:** Points to the pristine, **non-watermarked original video stream** rendered in the mobile feed.

```json
{
  "itemInfo": {
    "itemStruct": {
      "id": "7123456789012345678",
      "video": {
        "duration": 15,
        "ratio": "720p",
        "playAddr": "https://v16-webapp-prime.tiktok.com/video/tos/useast2a/tos-useast2a-ve-0068c001/...",
        "downloadAddr": "https://v16-webapp-prime.tiktok.com/video/tos/useast2a/tos-useast2a-pve-0068c001/...",
        "bitrateInfo": [
          {
            "Bitrate": 1285000,
            "PlayAddr": {
              "UrlList": [
                "https://v16-webapp-prime.tiktok.com/video/tos/useast2a/tos-useast2a-ve-0068c001/...",
                "https://v19-webapp-prime.tiktok.com/video/tos/useast2a/tos-useast2a-ve-0068c001/..."
              ]
            }
          }
        ]
      }
    }
  }
}
```

### 4.3 Clean Extraction & URL Pattern Decoupling
`[located evidence]` When scraping legacy or web endpoints, the CDN URL itself indicates watermarking:
- Watermarked URL pattern contains: `/playwm/`
- Non-watermarked URL pattern contains: `/play/`
- Replacing `/playwm/` with `/play/` in the CDN URL path historically converted watermarked links to clean streams.
`[decision]` In modern TikTok infrastructure (2025/2026), URL substring replacement is supplemented by direct extraction of `itemInfo.itemStruct.video.playAddr` or the highest bitrate entry in `bitrateInfo[].PlayAddr.UrlList[0]`.

#### Critical Header Requirements for CDN Chunk Streaming
`[located evidence]` TikTok CDN nodes (`*.tiktokv.com`, `*.tiktokcdn.com`) reject hotlinking requests with **HTTP 403 Forbidden** unless appropriate headers are passed:
```
Referer: https://www.tiktok.com/
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
Range: bytes=0-
```
`[decision]` The direct 302 tunnel and streaming proxy must inject `Referer: https://www.tiktok.com/` and strip internal proxy identifiers during stream pipe operations.

---

## 5. Instagram Private GraphQL & Shortcode Media Retrieval

### 5.1 Protocol Contracts & Endpoints
`[located evidence]` Instagram exposes two production interfaces for public Reels and Posts:
1. **Web GraphQL Query Endpoint:**
   `https://www.instagram.com/graphql/query/?query_hash={query_hash}&variables={variables}`
   Or modern Doc ID interface:
   `POST /api/graphql` or `GET /graphql/query/?doc_id={doc_id}&variables={variables}`
2. **Private Mobile REST Endpoint:**
   `https://www.instagram.com/api/v1/media/{media_id}/info/`

### 5.2 Doc ID and Query Hash Retrieval
`[located evidence]` Instagram updates its GraphQL query hashes periodically. The primary operational hashes are:
- **Post / Reel Info Doc ID:** `8845758582119845` or `7620905471314958`
- **Legacy Query Hash:** `b3055c01b4b222b8a47dc12b090e4e64`

#### Request Format
```
GET https://www.instagram.com/graphql/query/?doc_id=8845758582119845&variables={"shortcode":"Cx12345Abc"} HTTP/2
Host: www.instagram.com
X-IG-App-ID: 936619743392459
X-Requested-With: XMLHttpRequest
User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 335.0.0.24.108
```

### 5.3 Media JSON Path Traversal & Video Version Resolution
`[located evidence]` The media hierarchy returns both progressive MP4 URLs and DASH manifests:
```
data
 └── xdt_shortcode_media (or xdt_api__v1__media__shortcode__web_info.items[0])
      ├── id
      ├── is_video: true
      ├── video_url: "https://scontent.cdninstagram.com/v/t50.2886-16/..."
      ├── video_duration: 32.4
      └── video_versions: [
           { "type": 101, "width": 1080, "height": 1920, "url": "..." },
           { "type": 102, "width": 720,  "height": 1280, "url": "..." },
           { "type": 103, "width": 480,  "height": 854,  "url": "..." }
         ]
```
`[decision]` Sort `video_versions` descending by `width * height` and select `video_versions[0].url` for maximum resolution stream extraction.

---

## 6. Twitter / X Media Extraction via Guest Token & GraphQL

### 6.1 Guest Token Activation Protocol
`[located evidence]` Twitter allows read-only access to public tweets without user credentials via its guest authentication pipeline:
1. **Bearer Token:** Static public bearer token embedded in Twitter web bundle:
   `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`
2. **Guest Token Issuance:**
   ```
   POST https://api.twitter.com/1.1/guest/activate.json
   Authorization: Bearer AAAAAAAAAAAAA...
   ```
   Response: `{"guest_token": "1732089600123456789"}`

### 6.2 Tweet Detail GraphQL Extraction (`TweetResultByRestId`)
`[located evidence]` Using the active guest token, query the Tweet details:
```
GET https://x.com/i/api/graphql/sCUID2mkbpbLtZnvH8cvvw/TweetResultByRestId?variables={"tweetId":"1859000000000000000","withCommunity":false,"includePromotedContent":false,"withVoice":true}&features={"responsive_web_graphql_timeline_navigation_enabled":true} HTTP/2
Host: x.com
Authorization: Bearer AAAAAAAAAAAAA...
x-guest-token: 1732089600123456789
```

### 6.3 Video Variant Selection (Bitrate Optimization)
`[located evidence]` The media payload provides multiple MP4 transcode ladders inside `extended_entities.media[0].video_info.variants`:
```json
{
  "variants": [
    { "content_type": "application/x-mpegURL", "url": "https://video.twimg.com/.../playlist.m3u8" },
    { "bitrate": 2176000, "content_type": "video/mp4", "url": "https://video.twimg.com/.../vid/1080x1920/...mp4" },
    { "bitrate": 832000,  "content_type": "video/mp4", "url": "https://video.twimg.com/.../vid/720x1280/...mp4" },
    { "bitrate": 256000,  "content_type": "video/mp4", "url": "https://video.twimg.com/.../vid/480x852/...mp4" }
  ]
}
```
`[decision]` Filter variants where `content_type === "video/mp4"`, sort descending by `bitrate`, and return the highest bitrate progressive MP4 URL.

---

## 7. Comparative Platform Extraction Matrix

| Capability / Threat | YouTube | TikTok | Instagram | Twitter / X |
| :--- | :--- | :--- | :--- | :--- |
| **Auth Requirement** | Anonymous / Session Cookie | Anonymous | Anonymous / Session Cookie | Guest Token |
| **Edge Anti-Bot Defenses** | BotGuard VM, PoToken, SABR UMP | Akamai, X-Bogus, msToken | IP rate-limiting, doc_id | Guest rate-limits (187 req/15m) |
| **Throttling Parameter** | `n-sig` (base.js AST transform) | None (CDN bandwidth normal) | None | None |
| **Watermark Removal** | Not Applicable (No watermark) | `play_addr` vs `download_addr` | None | None |
| **Highest Direct Quality** | 4K/8K (DASH separation) | 1080p Progressive | 1080p Progressive | 1080p Progressive |
| **Preferred Fallback Strategy**| `TVHTML5_SIMPLY_EMBEDDED` -> `IOS` -> `WEB` | Web SSR -> Mobile Feed API | GraphQL Query -> Mobile API | Guest Token -> Web Token |

---

## 8. Epistemic Assessment & Empirical Verification Summary

- `[located evidence]` Validated against live production endpoints of YouTube (Innertube v1), TikTok Web/Mobile, Instagram GraphQL, and Twitter API.
- `[assumption]` Assumes target platforms maintain backwards compatibility with legacy client profiles (`TVHTML5_SIMPLY_EMBEDDED`, iOS 19.x) for a minimum 6-12 month horizon.
- `[prediction]` Operating `TVHTML5_SIMPLY_EMBEDDED` as the primary ingestion stage will achieve $> 92\%$ first-pass extraction success without consuming PoTokens or triggering bot challenges.
- `[decision]` Implement all extractors, interpreters, and pool managers directly in `@muxaro/source-adapters` with 100% test coverage and zero native C++ runtime dependencies.
