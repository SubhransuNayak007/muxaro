# MUXARO Official Brand Guidelines & Design System
**Project:** MUXARO Media Processing Platform  
**Author:** Principal Architect & System Designer (AGENT 01)  
**Document Status:** Approved Engineering & Brand Identity Standard  
**Version:** 1.0.0  
**Last Updated:** November 2026  

---

## 1. Brand Core & Mission

### 1.1 The MUXARO Identity
**MUXARO** is an enterprise-grade cloud media processing platform engineered for creators, developers, audio-video professionals, and power users who require absolute precision, uncompromising stream fidelity, and reliable automation.

- **Canonical Brand Name:** **MUXARO** (Stylized: **MUXARO** / Title case: **Muxaro** / CLI/Package: **muxaro**)
- **Official Tagline:** *"Your Media. One Powerful Workspace."*
- **Official Brand Description:** *"A powerful platform for authorised media downloading, processing and conversion."*

### 1.2 Brand Philosophy & Values
1. **Radical Technical Honesty:** We never engage in deceptive practices. We reject the legacy converter industry's gimmicks (fake 320 kbps MP3 upsampling, artificial 8K interpolation, and fake wait-timers). If an audio stream is natively 128 kbps Opus, we report it as 128 kbps Opus.
2. **Precision Engineering:** Complexity lives inside our distributed worker infrastructure—not in the user interface. Workflows are intuitive, immediate, and free from cognitive friction.
3. **Calm, Utility-First Aesthetic:** In accordance with the Hallmark design standard, MUXARO refuses generic AI-slop, flashing neon cards, deceptive banner ads, and fake social proof. We design software that looks and feels handcrafted by systems engineers.

---

## 2. Voice, Tone & Messaging

### 2.1 Voice Characteristics

| Dimension | How MUXARO Speaks | What MUXARO Avoids |
| :--- | :--- | :--- |
| **Clarity** | Direct, concise, technical when necessary, unambiguous. | Jargon for the sake of jargon; vague claims like "Instant AI magic!" |
| **Authenticity** | "Audio stream extracted natively as 160 kbps Opus without generational quality loss." | "Download in Ultra 320kbps Studio Master Sound!" (when source is lossy 128k). |
| **Tone** | Calm, dependable, professional, respectful of user time. | Sensationalist, exclamation-heavy, intrusive, or aggressive upsells. |
| **Errors** | Clear explanation of root cause + actionable next step (e.g. "Destination IP resides in a private RFC 1918 range and is blocked by SSRFGuard."). | "Oops! Something went wrong! Please try again later." |

---

## 3. Visual Identity System

### 3.1 The MUXARO Mark & Geometry
The MUXARO brand mark consists of two geometric, interlocking stream vectors forming a minimalist capital **'M'**:
- **Left Vector:** Represents raw, disparate ingress streams (video, audio, metadata).
- **Convergence Apex:** Represents high-velocity multiplexing (`mux`) and processing.
- **Right Vector:** Represents the unified, high-fidelity output container.

```
      /\          /\
     /  \        /  \
    / /\ \      / /\ \
   / /  \ \    / /  \ \
  / /    \ \  / /    \ \
 / /      \ \/ /      \ \
/ /        \  /        \ \
\/          \/          \/
```

### 3.2 Clear Space & Minimum Sizing
- **Clear Space:** Always maintain a minimum buffer around the logo equal to the width of the letter 'M' in the wordmark ($X$). No text, borders, or UI elements may encroach within this zone.
- **Minimum Digital Sizes:**
  - Full Logo (Mark + Wordmark): **120 px width** (or 24 px height).
  - Standalone Mark: **20 px x 20 px**.
  - Favicon / App Icon: **16 px x 16 px**.

### 3.3 Unacceptable Brand Usages
To preserve brand integrity:
- **DO NOT** skew, stretch, rotate, or horizontally flip the logo.
- **DO NOT** apply drop shadows, 3D extrusions, or outer glows to the mark.
- **DO NOT** place the logo over busy photographic backgrounds without an opaque backing container.
- **DO NOT** change the relative proportions of the mark to the wordmark.
- **DO NOT** replace the brand font with arbitrary system typefaces.

---

## 4. Color Architecture & Specifications

MUXARO employs a dark-canvas palette inspired by high-end video grading suites, illuminated by technical signal accents.

```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│                 │ │                 │ │                 │ │                 │
│  Onyx Void      │ │  Card Surface   │ │ Electric Indigo │ │   Signal Cyan   │
│  #0A0D14        │ │  #111520        │ │ #6366F1         │ │   #06B6D4       │
│  (Base Canvas)  │ │  (Elevated UI)  │ │ (Brand Primary) │ │   (High Accent) │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 4.1 Master Color Specifications

| Swatch Name | Hex Code | RGB | HSL | Semantic Role in UI |
| :--- | :--- | :--- | :--- | :--- |
| **Onyx Void** | `#0A0D14` | `10, 13, 20` | `222°, 33%, 6%` | Master background canvas, viewport root |
| **Card Surface** | `#111520` | `17, 21, 32` | `224°, 31%, 10%` | Primary cards, hero input container, table rows |
| **Elevated Surface** | `#181D2C` | `24, 29, 44` | `225°, 29%, 13%` | Active inspection cards, modals, dropdown menus |
| **Structural Border** | `#23293D` | `35, 41, 61` | `226°, 27%, 19%` | 1px clean borders, table dividers |
| **Electric Indigo** | `#6366F1` | `99, 102, 241` | `239°, 84%, 67%` | Primary CTA buttons, active tabs, brand anchor |
| **Indigo Hover** | `#4F46E5` | `79, 70, 229` | `243°, 75%, 59%` | Primary button `:hover` and `:active` state |
| **Signal Cyan** | `#06B6D4` | `6, 182, 212` | `189°, 94%, 43%` | Progress bars, stream-copy badges, key metrics |
| **White Slate** | `#F8FAFC` | `248, 250, 252` | `210°, 40%, 98%` | Primary text, headings (98% contrast ratio: 18.5:1) |
| **Slate Secondary** | `#94A3B8` | `148, 163, 184`| `215°, 20%, 65%` | Secondary labels, descriptions, table headers |
| **Slate Tertiary** | `#64748B` | `100, 116, 139`| `215°, 16%, 47%` | Codec footnotes, timestamps, disabled indicators |
| **Emerald Success** | `#10B981` | `16, 185, 129` | `160°, 84%, 39%` | Verified `READY` status, lossless stream badges |
| **Amber Notice** | `#F59E0B` | `245, 158, 11` | `38°, 92%, 50%`  | Active transcode warning, quota threshold nudge |
| **Crimson Error** | `#EF4444` | `239, 68, 68`  | `0°, 84%, 60%`   | SSRF rejection, failed verification, fatal error |

---

## 5. Typography System

The typography system pairs **Inter** (for human-centric UI, labels, and editorial clarity) with **JetBrains Mono** (for engineering data, bitrates, resolutions, codecs, and durations).

### 5.1 Type Scales & Roles

| Style | Font Family | Size | Weight | Line Height | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Display** | Inter Variable | `clamp(2.5rem, 5vw, 3.75rem)` | 700 (Bold) | 1.1 | -0.03em | Homepage Hero headline |
| **Section Heading** | Inter Variable | `1.75rem` (28px) | 600 (Semibold)| 1.25 | -0.02em | Tool pages, Admin dashboard titles |
| **Card Heading** | Inter Variable | `1.25rem` (20px) | 600 (Semibold)| 1.3 | -0.01em | Media inspection card title, modal heads |
| **Body Primary** | Inter Variable | `1.00rem` (16px) | 400 (Regular) | 1.5 | 0.00em | Paragraphs, documentation text |
| **Body Compact** | Inter Variable | `0.875rem` (14px) | 400 (Regular) | 1.4 | 0.00em | Table data, form inputs, button labels |
| **Code / Metrics** | JetBrains Mono | `0.8125rem` (13px)| 500 (Medium) | 1.4 | 0.00em | Bitrates (e.g. `18.4 Mbps`), codecs, hash IDs |
| **Micro Label** | Inter Variable | `0.75rem` (12px) | 500 (Medium) | 1.2 | +0.02em | Status pill tags, quota counters |

---

## 6. Hallmark Anti-AI-Slop Compliance Standard

All UI implementations for MUXARO must strictly observe the **Hallmark Floor**:

1. **Tokenized Theme Architecture:** Zero hardcoded hex colors or fonts past `:root`. All visual declarations must consume CSS custom properties.
2. **Instant Focus Visibility:** Every interactive button, input, tab, and link must provide an instant, unmistakable `:focus-visible` ring (`2px solid var(--muxaro-border-focus)` with `2px offset`).
3. **No Layout Shift (CLS = 0.0):** Media inspection cards must render within pre-allocated aspect-ratio containers to prevent layout jumps when thumbnails load.
4. **No Deceptive Animations:** Never use `transition: all`. Never animate `width` or `height` dynamically. Avoid slow artificial spinners intended to simulate "hard work".
5. **No Fake Metrics or Bogus Social Proof:** Zero fabricated "Over 10M downloads!", fake user reviews, or bogus client logo carousels. Trust is earned through performance and honest stream fidelity.

---
*Signed by AGENT 01 (Principal Architect & System Designer)*  
*Distribution: Swarm Board (@coordinator, @api, @frontend, @media, @adapters, @entitlements, @security, @seodocs, @infra, @qa)*
