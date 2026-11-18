# @muxaro/source-adapters

Source integration adapters, media stream inspection, rights declaration verification, and abuse defense engines for **MUXARO** (*"Your Media. One Powerful Workspace."*).

A powerful platform for authorised media downloading, processing and conversion.

---

## 1. Architectural Role & Responsibilities

The `@muxaro/source-adapters` package acts as the secure ingress inspection boundary for all media sources. It abstracts heterogeneous media inputs into a unified, strictly typed `MediaManifest` consumed by the REST API (`apps/api/`) and the Media Processing Worker (`apps/media-worker/`).

### Core Guarantees:
1. **Clean-room Separation**: Completely decoupled from GPL-licensed utilities and proprietary scraper tools.
2. **Strict Platform Compliance**: Audiovisual stream extraction from YouTube is permanently disabled (`status: 'DISABLED_PENDING_AGREEMENT'`). Absolutely NO proxy rotation, NO CAPTCHA solving, NO session hijacking, and NO scraping.
3. **SSRF Immunity**: Integrated defense against loopback, RFC1918 private subnets, cloud metadata services (`169.254.169.254`, `metadata.google.internal`), carrier-grade NAT, and DNS rebinding attacks.
4. **Verifiable Rights Gate**: Mandatory rights attestation checks distinguishing user-owned content, Creative Commons, public domain, and restricted third-party copyright.

---

## 2. Core Interfaces

### `SourceAdapter`
```typescript
export interface SourceAdapter {
  readonly name: string;
  readonly supportedProtocols: readonly string[];
  canHandle(url: string): boolean;
  inspect(url: string, options?: InspectOptions): Promise<MediaManifest>;
  checkRights(url: string, declaration?: RightsDeclaration): Promise<RightsCheckResult>;
  getCapabilities(): AdapterCapabilities;
}
```

### `MediaManifest`
Unified inspection result detailing containers, discovered streams, audio tracks, and rights status:
```typescript
export interface MediaManifest {
  sourceUrl: string;
  canonicalUrl: string;
  sourceType: 'direct_media' | 'youtube_permitted' | 'unsupported';
  title: string;
  author?: string;
  authorUrl?: string;
  thumbnailUrl?: string;
  description?: string;
  durationSeconds?: number;
  filesizeBytes?: number;
  container: ContainerFormat; // 'mp4' | 'webm' | 'mkv' | 'm4a' | 'mp3' | 'wav' | 'flac' | 'ogg' | 'aac'
  mimeType?: string;
  streams: MediaStream[];
  audioTracks: AudioTrack[];
  rights: RightsCheckResult;
  canExtractStreams: boolean;
  extractionPolicyNotice: string;
  previewUrl?: string;
  embedHtml?: string;
  metadata: Record<string, unknown>;
  inspectedAt: string;
}
```

### `MediaStream`
```typescript
export interface MediaStream {
  id: string;
  streamType: 'video' | 'audio' | 'muxed';
  container: ContainerFormat;
  codec?: string;
  resolution?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrateBps?: number;
  contentLengthBytes?: number;
  directUrl?: string;
  mimeType: string;
  isStreamExtractable: boolean;
  requiresRemux: boolean;
  requiresTranscode: boolean;
  headers?: Record<string, string>;
}
```

### `AudioTrack`
```typescript
export interface AudioTrack {
  id: string;
  codec: string;
  channels: number;
  sampleRateHz?: number;
  bitrateBps?: number;
  language?: string;
  isDefault?: boolean;
  contentLengthBytes?: number;
  directUrl?: string;
  mimeType: string;
  isExtractable: boolean;
}
```

### `RightsCheckResult`
```typescript
export interface RightsCheckResult {
  isPermitted: boolean;
  status: 'permitted' | 'restricted' | 'forbidden' | 'requires_authorization';
  policyCode: RightsPolicyCode;
  reason: string;
  canExtractStreams: boolean;
  canPreview: boolean;
  attributionRequired: boolean;
  rightsDeclaration?: RightsDeclaration;
  warnings: string[];
  checkedAt: string;
}
```

---

## 3. Adapters

### DirectMediaAdapter
Validates and inspects direct HTTP/HTTPS progressive media links:
- **Containers:** MP4, MKV, WebM, MP3, WAV, FLAC, M4A, OGG, AAC.
- **Probe Strategy:** Safe HTTP HEAD request with automated Range GET (`Range: bytes=0-0`) fallback for servers returning 405 Method Not Allowed.
- **Header Parsing:** `Content-Type`, `Content-Length`, `Accept-Ranges`, and RFC 5987 / 6266 `Content-Disposition` for authentic filenames.
- **Extraction Permission:** `canExtractStreams: true` for verified accessible media streams.

### YouTubePermittedAdapter
Provides permitted public metadata and official video preview ONLY:
- **Scope:** Official oEmbed metadata resolution (`https://www.youtube.com/oembed?url=...&format=json`) and secure no-cookie embed preview (`https://www.youtube-nocookie.com/embed/{id}`).
- **Extraction Policy:** `canExtractStreams: false` **ALWAYS**. Direct audiovisual stream extraction is strictly disabled.
- **Policy Notice:**
  > *"Audiovisual stream extraction from YouTube is disabled in compliance with YouTube Terms of Service and developer policies. Extraction requires a direct platform API agreement or verified private copyright authorization."*
- **Rejection of Evasion:** Calling `getDownloadStreams(...)` throws `ExtractionDisabledError` (`ERR_SOURCE_PLATFORM_NOT_PERMITTED`).

---

## 4. Rights Declaration & Abuse Defense

### AbuseDetector
Scans incoming URLs for security and policy threats:
- Prohibits shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, `<`, `>`, `'`, `"`, `\n`).
- Blocks embedded credentials (`http://user:pass@host/`).
- Blocks evasion query parameters (`rotate_proxy`, `bypass`, `captcha_solver`, `scrape`).
- Blocks path traversal patterns (`../`, `..%2f`).

### RightsValidator
Evaluates user legal declarations:
- `user_created_content`: Requires affirmative attestation (`attestation: true`).
- `creative_commons`: Enforces author attribution requirement (`attributionRequired: true`).
- `public_domain`: Validated for free conversion and extraction.
- `licensed_permission`: Checks license type and documentation notes.
- `third_party_copyright`: Flags content as restricted; blocks extraction.

---

## 5. Usage Example

```typescript
import {
  inspectMediaUrl,
  checkMediaRights,
  defaultAdapterRegistry,
} from '@muxaro/source-adapters';

// 1. Inspect direct media link
const manifest = await inspectMediaUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', {
  rightsDeclaration: {
    ownershipType: 'creative_commons',
    attestation: true,
    licenseType: 'CC-BY-3.0',
  },
});

console.log(manifest.title); // "BigBuckBunny"
console.log(manifest.container); // "mp4"
console.log(manifest.canExtractStreams); // true

// 2. Inspect YouTube link (Permitted metadata & preview only)
const ytManifest = await inspectMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
console.log(ytManifest.canExtractStreams); // false (STRICT ENFORCEMENT)
console.log(ytManifest.embedHtml); // Safe <iframe> preview player
console.log(ytManifest.extractionPolicyNotice); // Legal compliance disclosure
```

---

## 6. Build and Test

```bash
# Run all unit test suites
pnpm test

# Build TypeScript declarations and ESM bundles to dist/
pnpm run build

# Run type check
pnpm run typecheck
```
