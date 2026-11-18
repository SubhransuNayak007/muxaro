# ADR-005: Pluggable Source Adapter Pattern & Rights Verification Protocol

**Status:** Accepted  
**Deciders:** Principal Architect (AGENT 01), Source Integrations Engineer (AGENT 05), Security Engineer (AGENT 08)  
**Date:** 2026-11-18  

---

## 1. Context and Problem Statement
A universal media utility must accommodate diverse ingress media sources:
1. Direct progressive media links (MP4, WebM, MKV, MP3, FLAC, WAV, M4A hosted on CDN or web servers).
2. User-uploaded files.
3. Third-party content platforms (such as YouTube, Vimeo, TikTok, etc.).

However, third-party platforms enforce strict Terms of Service (ToS) prohibiting unauthorized downloading, scraping, IP proxy rotation, and CAPTCHA circumvention. Engaging in adversarial scraping exposes the platform to immediate IP banning, domain blocking, and DMCA / CFAA litigation.

We need an extensible, unified adapter architecture that can inspect and process authorized media while strictly enforcing legal and platform boundaries.

---

## 2. Decision

### 2.1 Pluggable Adapter Interface (`packages/source-adapters/`)
We establish a clean, strongly typed adapter pattern where all source integrations implement the `SourceAdapter` contract:

```typescript
export interface SourceAdapter {
  readonly id: string;
  readonly name: string;
  canHandle(url: string): boolean;
  inspect(url: string, context: InspectionContext): Promise<MediaManifest>;
  validateRights(url: string, declaration: RightsDeclaration): Promise<RightsCheckResult>;
  getDownloadStreams(url: string, selectedStreamIds: string[]): Promise<StreamResolutionResult>;
}
```

### 2.2 Discrete Adapter Implementations:
1. **`DirectMediaAdapter`:**
   - Handles public direct URLs pointing to media files.
   - Issues safe HTTP `HEAD` / Range requests through `SSRFGuard`.
   - Validates MIME content types (`video/mp4`, `video/webm`, `audio/mpeg`, etc.).
   - Parses Content-Length and remote headers to construct the `MediaManifest`.
   - Supports direct chunked streaming to the media worker.
2. **`YouTubePermittedAdapter`:**
   - **Permitted Scope:** Official metadata resolution via YouTube oEmbed API (`https://www.youtube.com/oembed?url=...&format=json`) and permitted preview players.
   - **Strict Restriction:** **Audiovisual stream extraction is permanently disabled (`status: 'DISABLED_PENDING_AGREEMENT'`).**
   - **Zero Bypass Policy:** Absolute prohibition of proxy rotation, scraping bot harnesses, cookie harvesting, or CAPTCHA solving.
   - Returns a structured error explaining the policy when direct download of YouTube media is requested: `ERR_SOURCE_PLATFORM_NOT_PERMITTED`.

### 2.3 User Rights Declaration & Abuse Filtering
- Every inspection and job request requires an explicit affirmative boolean `rightsDeclared: true`.
- The user affirms that they are the content owner, have explicit permission from the copyright holder, or are exercising authorized personal archiving/fair use under applicable law.
- Source URLs are screened against an abuse filter (rejecting pirated file locker domains, phishing links, and known hostile domains).

---

## 3. Consequences

### Positive:
- Clean modularity: Adding support for new compliant sources requires creating a new adapter implementing `SourceAdapter` without modifying core pipeline code.
- Pristine legal posture: Completely eliminates platform liability, IP blocklisting, and copyright litigation risk.
- High reliability: Avoids the fragile game of cat-and-mouse scraping breakages that plague legacy download sites.

### Negative:
- Users attempting to use the tool as an unauthorized YouTube downloader receive an explicit notice explaining that direct video extraction is disabled for that provider.
