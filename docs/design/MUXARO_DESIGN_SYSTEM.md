# MUXARO Design System Specification (v2.0)
**Product:** MUXARO Media Processing Platform  
**Author:** Principal Architect & System Designer (AGENT 01)  
**Document Status:** Approved Engineering & UX Baseline  
**Theme Model:** Light-First Consumer SaaS with Universal Dark Mode Support  
**Design Standard:** Hallmark Anti-AI-Slop Compliant  
**Last Updated:** November 2026  

---

## 1. Executive Summary & Design Vision

MUXARO Design System v2.0 represents a transformative evolution in user experience: transitioning from a dense, dark-mode engineering console into a **light-first, modern, consumer-grade media workspace** inspired by modern high-utility SaaS platforms (SkyScribe, Onliweb, Linear).

### Core Pillars:
1. **Effortless Simplicity (Zero Cognitive Overload):** A clean, welcoming, light-first canvas centered on immediate dual-mode input (Paste URL / Upload File) with friendly presets ("Best Quality", "Balanced", "Audio-Only", "Lossless").
2. **Progressive Disclosure:** Deep technical stream details (codecs, bitrates, audio channels, FFprobe parameters) are preserved in full fidelity within an elegant, collapsible **"Advanced Engineering Drawer"**, giving professionals complete control while keeping the interface pristine for mainstream creators.
3. **Radical Fidelity & Honesty:** No deceptive upsampling claims (e.g. fake 320 kbps MP3s), no fake counters, no dark-pattern ad redirects.
4. **Sub-Second Performance & CWV Discipline:** Zero render-blocking external stylesheets; dynamic code-splitting; Next.js `next/font/google` with `display: 'swap'` to guarantee LCP < 1.2s.

---

## 2. Color Architecture & Token System

The color system is engineered for exceptional visual clarity, featuring an airy, modern light-first palette powered by high-energy multi-stop brand gradients, with an automated high-contrast dark mode fallback.

```
LIGHT CANVAS (Default):
┌─────────────────┐ ┌─────────────────┐ ┌───────────────────────────────────┐
│ Base Canvas     │ │ Card Surface    │ │ MUXARO Brand Accent Gradient      │
│ #F7F8FC         │ │ #FFFFFF         │ │ #695BFF ──► #4677FF ──► #36D6D1   │
│ (Subtle Slate)  │ │ (Crisp White)   │ │ (Electric Indigo ➔ Blue ➔ Cyan)   │
└─────────────────┘ └─────────────────┘ └───────────────────────────────────┘

DARK CANVAS (Toggle):
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Dark Base       │ │ Dark Surface    │ │ Dark Elevated   │
│ #0A0D14         │ │ #111520         │ │ #181D2C         │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 2.1 Design Tokens (`apps/web/app/globals.css`)

```css
/* Hallmark · theme: MUXARO Consumer SaaS v2.0 · surface: absolute · shape: app screen · posture: committed · hero: custom · nav: edge-aligned · footer: mast */
:root {
  /* Brand Core Palette */
  --muxaro-indigo: #695bff;
  --muxaro-blue: #4677ff;
  --muxaro-cyan: #36d6d1;
  --muxaro-gradient-primary: linear-gradient(135deg, #695bff 0%, #4677ff 50%, #36d6d1 100%);
  --muxaro-gradient-hover: linear-gradient(135deg, #5b4de6 0%, #3b6bee 50%, #2cc5c0 100%);
  --muxaro-gradient-subtle: linear-gradient(135deg, rgba(105, 91, 255, 0.08) 0%, rgba(70, 119, 255, 0.08) 100%);

  /* Light Theme (Default Consumer SaaS Canvas) */
  --muxaro-bg-base: #f7f8fc;
  --muxaro-bg-surface: #ffffff;
  --muxaro-bg-elevated: #f1f3f9;
  --muxaro-bg-interactive: #eef1f8;

  --muxaro-border: #e8eaf1;
  --muxaro-border-subtle: #f0f2f7;
  --muxaro-border-focus: #695bff;

  --muxaro-text-primary: #171b2b;
  --muxaro-text-secondary: #5e667e;
  --muxaro-text-tertiary: #666e85;

  /* Status Semantics */
  --muxaro-success: #10b981;
  --muxaro-success-bg: rgba(16, 185, 129, 0.1);
  --muxaro-warning: #f59e0b;
  --muxaro-warning-bg: rgba(245, 158, 11, 0.1);
  --muxaro-error: #ef4444;
  --muxaro-error-bg: rgba(239, 68, 68, 0.1);
  --muxaro-info: #4677ff;
  --muxaro-info-bg: rgba(70, 119, 255, 0.1);

  /* Shadows & Elevation */
  --muxaro-shadow-sm: 0 1px 3px rgba(23, 27, 43, 0.04);
  --muxaro-shadow-md: 0 4px 14px rgba(23, 27, 43, 0.06), 0 1px 3px rgba(23, 27, 43, 0.04);
  --muxaro-shadow-lg: 0 12px 32px rgba(23, 27, 43, 0.08), 0 2px 6px rgba(23, 27, 43, 0.04);
  --muxaro-shadow-focus: 0 0 0 3px rgba(105, 91, 255, 0.25);
  --muxaro-shadow-btn: 0 2px 8px rgba(105, 91, 255, 0.25);
  --muxaro-shadow-btn-hover: 0 4px 14px rgba(105, 91, 255, 0.35);

  /* Hero Ambient Wash & Control Foreground */
  --muxaro-btn-fg: #ffffff;
  --muxaro-hero-wash: radial-gradient(78% 52% at 50% -6%, rgba(105, 91, 255, 0.11) 0%, rgba(70, 119, 255, 0.05) 45%, rgba(54, 214, 209, 0.03) 72%, rgba(247, 248, 252, 0) 100%);
  --dark-hero-wash: radial-gradient(78% 52% at 50% -6%, rgba(105, 91, 255, 0.2) 0%, rgba(70, 119, 255, 0.09) 45%, rgba(54, 214, 209, 0.04) 72%, rgba(10, 13, 20, 0) 100%);

  /* Radii */
  --muxaro-radius-sm: 6px;
  --muxaro-radius-md: 10px;
  --muxaro-radius-lg: 16px;
  --muxaro-radius-full: 9999px;

  /* Dark Theme Tokens Declared in Root Token Block (Zero literals outside :root) */
  --dark-bg-base: #0a0d14;
  --dark-bg-surface: #111520;
  --dark-bg-elevated: #181d2c;
  --dark-bg-interactive: #1f2538;
  --dark-border: #23293d;
  --dark-border-subtle: #1a1f2e;
  --dark-border-focus: #695bff;
  --dark-text-primary: #f5f7fc;
  --dark-text-secondary: #9aa8be;
  --dark-text-tertiary: #7887a2;
}

/* High-Contrast Dark Mode Activation (Class & Data Attribute Parity) */
.dark,
[data-theme="dark"] {
  --muxaro-bg-base: var(--dark-bg-base);
  --muxaro-bg-surface: var(--dark-bg-surface);
  --muxaro-bg-elevated: var(--dark-bg-elevated);
  --muxaro-bg-interactive: var(--dark-bg-interactive);
  --muxaro-border: var(--dark-border);
  --muxaro-border-subtle: var(--dark-border-subtle);
  --muxaro-border-focus: var(--dark-border-focus);
  --muxaro-text-primary: var(--dark-text-primary);
  --muxaro-text-secondary: var(--dark-text-secondary);
  --muxaro-text-tertiary: var(--dark-text-tertiary);
  --muxaro-hero-wash: var(--dark-hero-wash);
}
```

### 2.2 Verified WCAG 2.1 Contrast Matrix

| Pair | Mode | Contrast Ratio | WCAG Status |
| :--- | :--- | :--- | :--- |
| Primary Text (`#171B2B`) on Card Surface (`#FFFFFF`) | Light | **17.10 : 1** | AAA Pass |
| Primary Text (`#171B2B`) on Base Canvas (`#F7F8FC`) | Light | **16.11 : 1** | AAA Pass |
| Secondary Text (`#5E667E`) on Card Surface (`#FFFFFF`) | Light | **5.71 : 1** | AA Pass |
| Secondary Text (`#5E667E`) on Base Canvas (`#F7F8FC`) | Light | **5.38 : 1** | AA Pass |
| Tertiary Text (`#666E85`) on Card Surface (`#FFFFFF`) | Light | **5.05 : 1** | AA Pass |
| Tertiary Text (`#666E85`) on Base Canvas (`#F7F8FC`) | Light | **4.75 : 1** | AA Pass |
| Button Foreground (`#FFFFFF`) on Brand Indigo (`#695BFF`) | Light/Dark | **4.62 : 1** | AA Pass |
| Primary Text (`#F5F7FC`) on Dark Surface (`#111520`) | Dark | **17.01 : 1** | AAA Pass |
| Primary Text (`#F5F7FC`) on Dark Base (`#0A0D14`) | Dark | **18.13 : 1** | AAA Pass |
| Secondary Text (`#9AA8BE`) on Dark Surface (`#111520`) | Dark | **7.57 : 1** | AAA Pass |
| Tertiary Text (`#7887A2`) on Dark Surface (`#111520`) | Dark | **5.02 : 1** | AA Pass |
| Brand Cyan (`#36D6D1`) on Dark Base (`#0A0D14`) | Dark | **10.82 : 1** | AAA Pass |

---

## 3. Typography Hierarchy & Font Loading

To eliminate the 6,600ms LCP font-render penalty discovered in the performance audit:
1. **Next.js Native Font Integration:** Loaded via `next/font/google` (`Inter` for UI, `JetBrains_Mono` for technical metadata) with `display: 'swap'`.
2. **Zero Render-Blocking `<link>` Tags:** External Google Fonts stylesheet links in `<head>` are eliminated.

### 3.1 Typographic Scale

| Role | Font Family | Size | Weight | Line Height | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Title** | Inter Sans | `clamp(2.25rem, 4.5vw, 3.5rem)` | 800 (Extrabold) | 1.15 | -0.03em | Primary value proposition |
| **Section Title** | Inter Sans | `1.75rem` (28px) | 700 (Bold) | 1.25 | -0.02em | Tool pages, Capability headers |
| **Card Title** | Inter Sans | `1.25rem` (20px) | 600 (Semibold)| 1.35 | -0.01em | Inspection card, Preset options |
| **Body Primary**| Inter Sans | `1.00rem` (16px) | 400 (Regular) | 1.55 | 0.00em | Descriptions, FAQ answers, Legal text |
| **Body Small**  | Inter Sans | `0.875rem` (14px)| 500 (Medium) | 1.45 | 0.00em | Form labels, button text, badges |
| **Technical Data**| JetBrains Mono| `0.8125rem` (13px)| 500 (Medium)| 1.40 | 0.00em | Bitrates (e.g. `160 kbps`), True resolutions |

---

## 4. Component Architectural Specifications

### 4.1 Hero Workspace & Dual-Mode Ingress Input
The primary ingress component features a unified card with tabbed inputs:
- **Tab 1: "Paste URL" (Active Default):** High-contrast text input with auto-paste clipboard button, supporting direct media URLs and permitted sources.
- **Tab 2: "Upload File":** Drag-and-drop file target with immediate local client-side probing.
- **Action Trigger:** "Analyze Media" button carrying the signature MUXARO gradient (`--muxaro-gradient-primary`), converting to a non-blocking skeleton upon submission.

### 4.2 Four Primary Capability Cards
Directly beneath the hero, four responsive feature cards communicate platform capabilities:
1. **Video Processing:** Stream-copy remuxing up to genuine 8K with zero quality loss.
2. **Audio Extraction:** Native lossless extraction to Opus, AAC, FLAC, or MP3.
3. **Video / Audio Merger:** Synchronize and multiplex separate tracks with millisecond offset tuning.
4. **Batch & Playlists:** Process up to 50 items simultaneously with automated ZIP packaging.

### 4.3 Three-Step "How It Works" Onboarding Guide
An intuitive horizontal workflow illustration:
- **Step 1:** Paste URL or upload local media.
- **Step 2:** Select an instant preset or fine-tune codecs in Advanced Settings.
- **Step 3:** Download verified high-fidelity output artifact.

### 4.4 Media Inspection Card with Preset Cards & Advanced Drawer
When an asset is inspected, the interface avoids overwhelming users with 20 codec table rows. Instead, it presents **4 Instant Presets**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ [THUMBNAIL]   Nature Cinematic 4K Landscape                            │
│               Duration: 04:12 • Format: MP4/H.264 • Bitrate: 18.4 Mbps │
├────────────────────────────────────────────────────────────────────────┤
│ SELECT A PRESET:                                                       │
│ ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────┐ │
│ │ ★ Best Quality (4K)  │ │ ⚡ Balanced (1080p)  │ │ 🎵 Audio Only    │ │
│ │ Native Stream Copy   │ │ Fast Universal Play  │ │ Lossless Opus    │ │
│ │ ~420 MB • Zero Loss  │ │ ~110 MB • Instant    │ │ ~4.8 MB • Native │ │
│ └──────────────────────┘ └──────────────────────┘ └──────────────────┘ │
├────────────────────────────────────────────────────────────────────────┤
│ ▸ Advanced Stream Matrix (Click to inspect all audio/video tracks)     │
└────────────────────────────────────────────────────────────────────────┘
```

- **Collapsible Advanced Drawer:** Clicking opens the full, granular stream matrix (exact video streams 8K-360p, audio streams with bitrates, sample rates, channels, and custom FFmpeg remuxing parameters).

---

## 5. Hallmark Anti-AI-Slop Governance

1. **Zero AI Hallucinations:** No fake user testimonials, no fabricated "10,000,000+ happy users" counters.
2. **Token Floor Enforcement:** All colors, shadows, and radii are governed by CSS variables.
3. **Instant Focus Visibility:** Complete accessibility with high-contrast keyboard rings on all interactive elements.
4. **Responsive Integrity:** Mobile-first layout testing down to 320px viewport with zero horizontal scroll overflow.

---
*Signed by AGENT 01 (Principal Architect & System Designer)*  
*Distribution: Swarm Board (@coordinator, @frontend, @qa, @seodocs)*
