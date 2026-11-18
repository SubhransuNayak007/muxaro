# MUXARO Digital & Brand Asset Inventory
**Project:** MUXARO Media Processing Platform  
**Author:** Principal Architect & System Designer (AGENT 01)  
**Document Status:** Approved Engineering & Design Specification  
**Asset Baseline:** Version 1.0.0 (Production Release)  
**Last Updated:** November 2026  

---

## 1. Executive Summary & Asset Architecture

This inventory specifies every visual, vector, programmatic, and metadata asset comprising the **MUXARO** brand identity. It serves as the single source of truth for `@frontend`, `@seodocs`, `@infra`, and `@qa` to ensure 100% visual consistency, pixel precision, and format compliance across the web application, API documentation, and social previews.

---

## 2. Master Asset Registry

### 2.1 Vector Brand Identity Assets (`apps/web/public/brand/`)

| Asset File | Format | Native Dimensions | Purpose / Context | Design Attributes |
| :--- | :--- | :--- | :--- | :--- |
| **`muxaro-logo.svg`** | Scalable Vector (SVG) | 240 x 48 px | Primary full brand identity (Mark + Wordmark) for Desktop Navigation, Header, and Documentation | Dark & light theme responsive via `currentColor` / CSS variables. Contains iconic 'M' stream-split mark and geometric typography. |
| **`muxaro-logo-white.svg`** | Scalable Vector (SVG) | 240 x 48 px | High-contrast monochrome white logo for dark footers, video overlays, and dark-mode splash screens | Pure `#FFFFFF` fills on mark and wordmark. |
| **`muxaro-logo-black.svg`** | Scalable Vector (SVG) | 240 x 48 px | High-contrast monochrome black logo for print, documentation PDF export, and light paper backgrounds | Pure `#000000` fills. |
| **`muxaro-mark.svg`** | Scalable Vector (SVG) | 48 x 48 px | Standalone brand icon / monogram for mobile navigation, compact headers, app launcher, and avatars | Iconic dual-chevron / stream-split 'M' symbol representing multiplexed media streams converging into a unified workspace. |
| **`muxaro-mark-gradient.svg`** | Scalable Vector (SVG) | 48 x 48 px | Full-color gradient version of the monogram for app icon tiles and featured hero badges | Linear gradient from Muxaro Electric Indigo (`#6366F1`) to Signal Cyan (`#06B6D4`). |
| **`muxaro-wordmark.svg`** | Scalable Vector (SVG) | 180 x 36 px | Typography-only wordmark for inline text headers, footer lockups, and compact toolbars | Bespoke geometric tracking, uppercase letterforms with optical kerning. |

---

### 2.2 Favicons & Browser App Icons (`apps/web/public/`)

| Asset File | Format | Target Resolution | Platforms Supported |
| :--- | :--- | :--- | :--- |
| **`favicon.ico`** | Multi-resolution ICO | 16x16, 32x32, 48x48 px | Legacy desktop browsers, IE11, desktop search engines |
| **`favicon.svg`** | Scalable Vector (SVG) | Vector (Scalable) | Modern evergreen browsers (Chrome, Firefox, Safari 14+, Edge); adapts to OS dark/light mode |
| **`favicon-16x16.png`** | Raster PNG | 16 x 16 px | Browser tab icon (Standard DPI displays) |
| **`favicon-32x32.png`** | Raster PNG | 32 x 32 px | Browser tab icon (Retina / High DPI displays), Windows taskbar pinned site |
| **`apple-touch-icon.png`** | Raster PNG | 180 x 180 px | iOS Home Screen shortcut, iPad Safari bookmarks |
| **`android-chrome-192x192.png`** | Raster PNG | 192 x 192 px | Progressive Web App (PWA) splash / launcher for Android devices |
| **`android-chrome-512x512.png`** | Raster PNG | 512 x 512 px | PWA high-res splash screen, Google Play Store web listing |
| **`safari-pinned-tab.svg`** | Monotone SVG | Vector (Scalable) | macOS Safari pinned tab icon (single color mask `#6366F1`) |

---

### 2.3 OpenGraph, Social & Rich Media Previews (`apps/web/public/brand/`)

| Asset File | Format | Dimensions | Usage Context | Content / Layout |
| :--- | :--- | :--- | :--- | :--- |
| **`og-image-muxaro.png`** | 24-bit PNG | 1200 x 630 px | Facebook, LinkedIn, Discord, Slack, iMessage unfurl preview | High-contrast dark background (`#0A0D14`), centered Muxaro mark + wordmark, tagline *"Your Media. One Powerful Workspace."*, and feature badge array (8K Video, Lossless Audio, Zero Fake Upsampling). |
| **`twitter-card-muxaro.png`**| 24-bit PNG | 1200 x 600 px | X (Twitter) large summary card (`summary_large_image`) | Optimized for 2:1 aspect ratio with clean margin boundaries for mobile Twitter feeds. |

---

## 3. Brand Identity Token Architecture

To adhere to the mandatory Hallmark design standard, all brand tokens are declared at `:root` in `apps/web/app/globals.css`:

```css
/* =============================================================================
   MUXARO Canonical Design Tokens (Hallmark Floor Compliant)
   ============================================================================= */
:root {
  /* Brand Core Palette */
  --muxaro-primary: #6366f1;          /* Electric Indigo (Brand Primary) */
  --muxaro-primary-hover: #4f46e5;    /* Deep Indigo (Interactive Hover) */
  --muxaro-primary-subtle: rgba(99, 102, 241, 0.12); /* 12% Brand Tint */
  --muxaro-accent: #06b6d4;           /* Signal Cyan (High-Fidelity Accent) */
  --muxaro-accent-hover: #0891b2;     /* Deep Cyan */
  
  /* Surface & Background Hierarchy */
  --muxaro-bg-base: #0a0d14;         /* Onyx Void (Master Background) */
  --muxaro-bg-surface: #111520;      /* Elevated Workspace Card */
  --muxaro-bg-elevated: #181d2c;     /* Inspection & Modal Surface */
  --muxaro-border: #23293d;          /* Subtle Structural Border */
  --muxaro-border-focus: #6366f1;    /* Instant :focus-visible Ring */
  
  /* Text & Foreground Hierarchy */
  --muxaro-text-primary: #f8fafc;    /* High-Contrast White-Slate (98% luminance) */
  --muxaro-text-secondary: #94a3b8;  /* Muted Technical Slate */
  --muxaro-text-tertiary: #64748b;   /* Low-Emphasis Metadata */
  
  /* Functional Status Tokens */
  --muxaro-success: #10b981;         /* Authentic Stream / Verified READY */
  --muxaro-warning: #f59e0b;         /* Processing Queue / Quota Nudge */
  --muxaro-error: #ef4444;           /* SSRF Blocked / Fatal Job Error */
  --muxaro-info: #3b82f6;            /* Metadata Probe Info */

  /* Typography */
  --muxaro-font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --muxaro-font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}
```

---

## 4. Codebase Brand Constants Definition

All programmatic instances of brand strings across the monorepo must reference the centralized TypeScript constants located at `packages/config/brand.ts` and re-exported in `apps/web/lib/brand.ts`:

```typescript
export const MUXARO_BRAND = {
  name: 'MUXARO',
  displayName: 'Muxaro',
  legalName: 'Muxaro Platform Services',
  tagline: 'Your Media. One Powerful Workspace.',
  description: 'A powerful platform for authorised media downloading, processing and conversion.',
  url: 'https://muxaro.com',
  apiUrl: 'https://api.muxaro.com/api/v1',
  supportEmail: 'support@muxaro.com',
  social: {
    twitter: '@muxaroapp',
    github: 'https://github.com/muxaro/muxaro',
  },
  quotas: {
    freeIndividualJobs: 10,
    freePlaylistJobs: 1,
    maxPlaylistItems: 50,
    windowHours: 24,
  },
} as const;

export type MuxaroBrandConfig = typeof MUXARO_BRAND;
```

---

## 5. Quality Assurance & Brand Audit Checklist

Every PR and deployment must pass the following brand verification gate:

- [ ] **Zero Legacy Codename Leaks:** Global grep for `VYRO` / `Vyro` across user-facing HTML, titles, metadata, footers, and error messages returns zero results (with the sole exception of historical architecture changelogs).
- [ ] **Vector Precision:** All SVG icons in `apps/web/public/brand/` render cleanly at 16x16, 24x24, 48x48, and 240x48 without blurriness or fractional pixel clipping.
- [ ] **Hallmark Floor Compliance:** First non-empty line of CSS source carries the Hallmark stamp; zero arbitrary hex codes past the token declaration block.
- [ ] **Social Card Validation:** OpenGraph images validate through Facebook Sharing Debugger, Twitter Card Validator, and LinkedIn Post Inspector.
- [ ] **Favicon Multi-Platform Audit:** Verified on Safari (macOS), Chrome (Windows/Android), and iOS Mobile Safari home screen.

---
*Signed by AGENT 01 (Principal Architect & System Designer)*  
*Distribution: Swarm Board (@coordinator, @api, @frontend, @media, @adapters, @entitlements, @security, @seodocs, @infra, @qa)*
