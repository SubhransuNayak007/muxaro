# MUXARO — Search Intent Architecture & Funnel Mapping

> **Classification:** User Search Intent & Conversion Path Specification  
> **Brand:** MUXARO (`muxaro.com`)  
> **Prepared by:** Chief SEO & Organic Growth Strategist (@seodocs)

---

## 1. Intent Model Framework

Search engines do not rank keywords; they rank the web pages that most effectively and efficiently satisfy the user's underlying **Search Intent**.

```
Search Query Entered
        │
        ├───────────────────────────────────────────────────────┐
        ▼                                                       ▼
[ Informational / Diagnostic ]                         [ Transactional / Utility ]
"why is audio out of sync"                             "online audio extractor"
        │                                                       │
        ▼                                                       ▼
Expectation: Clear answer, no fluff,                   Expectation: Immediate tool,
authoritative explanation & fix                         dropzone above the fold, 0 ads
        │                                                       │
        ▼                                                       ▼
Delivery: /docs/troubleshooting                         Delivery: /tools/audio-extractor
(Explains PTS drift, gives FFmpeg command)              (Instant analysis card, 1-click)
        │                                                       │
        └───────────────────────┬───────────────────────────────┘
                                │
                                ▼
              Habitual Repeat User of MUXARO Workspace
```

---

## 2. Intent Tier Mapping

### 2.1 Transactional Intent (Immediate Utility)
- **User Mindset:** *"I have a file right now, and I need to extract the audio / merge video tracks in 30 seconds."*
- **Primary Pages:** `/tools/audio-extractor`, `/tools/audio-video-merger`, `/tools/media-converter`, `/tools/batch-processing`.
- **UX Requirements:**
  - Zero cognitive friction: Drag-and-drop zone visible above the fold at $1280 \times 800$.
  - No required signup before running first job.
  - Zero full-screen modal takeovers or interstitial video ads.
  - Clear, immediate progress indicator via Server-Sent Events (SSE).
- **SEO Elements:**
  - `SoftwareApplication` & `HowTo` schema tags.
  - Clear H1 declaring exact capability.

### 2.2 Informational Intent (Media Education & Formats)
- **User Mindset:** *"I am rendering a video for YouTube or archiving my music collection. What is the difference between MP4 and WebM, or AAC and Opus?"*
- **Primary Pages:** `/docs/formats`, `/docs/resolutions`, `/docs/audio-quality`.
- **UX Requirements:**
  - Deep technical depth: diagrams, bitstream structures, codec comparison tables.
  - Verifiable mathematical truths: Nyquist-Shannon proofs, psychoacoustic masking curves.
  - Terminal FFmpeg parity commands for power users.
  - Contextual link to matching tool without high-pressure marketing banners.
- **SEO Elements:**
  - `TechArticle` schema with author credentials and published timestamps.
  - Clear table of contents with anchor links.

### 2.3 Diagnostic Intent (Error Remediation)
- **User Mindset:** *"My video is broken. The sound is 2 seconds behind the video, or my player says 'moov atom not found'. How do I fix it?"*
- **Primary Pages:** `/docs/troubleshooting`, `/docs/faq`.
- **UX Requirements:**
  - Direct diagnostic table at top of page mapping symptoms to root causes and fixes.
  - FFmpeg terminal repair commands.
  - Clear callout explaining how MUXARO's automated stream-copy handles this automatically.
- **SEO Elements:**
  - `FAQPage` schema.
  - Rich snippet answer targets in paragraph one.

### 2.4 Navigational Intent (Brand & Governance)
- **User Mindset:** *"I want to access MUXARO, check my daily rolling credits, or read their copyright/DMCA policies."*
- **Primary Pages:** `/`, `/credits`, `/dashboard`, `/status`, `/legal/terms`, `/legal/privacy`, `/legal/dmca`.
- **UX Requirements:**
  - Real-time rolling quota countdown timer.
  - Transparent legal notices.
  - Real-time system health dashboard.

---

## 3. Conversion Funnel: From Reader to Active Creator

```
Informational Reader
  (Reads /docs/formats on WebM vs MP4)
        │
        ▼ (Contextual Text Link: "Inspect stream atoms using MUXARO Inspector")
Tool User
  (Analyzes first video; receives instant FFprobe stream card)
        │
        ▼ (Executes zero-loss stream copy extraction in 3 seconds)
Satisfied Creator
  (Observes honest quota counter and zero ad popups)
        │
        ▼ (Bookmarks muxaro.com)
Daily Habitual Workspace User
```

---

*Authored by Chief SEO & Organic Growth Strategist for MUXARO.*
