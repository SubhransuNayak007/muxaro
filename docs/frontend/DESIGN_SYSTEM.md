# MUXARO Design System

**Source of Truth:** `apps/web/app/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/app/layout.tsx`  
**Theme Architecture:** Light-first Consumer SaaS with Dark Mode parity (`.dark` and `[data-theme="dark"]`)  
**Design Standard:** Hallmark Anti-AI-Slop Floor compliant (stamped on line 1 of `apps/web/app/globals.css`)

---

## 1. Design Principles

1. **Tokenized Single Source of Truth:** Every color, gradient, elevation shadow, radius, and font family is declared in `:root` inside `apps/web/app/globals.css` and consumed via CSS custom properties and Tailwind semantic utilities in `apps/web/tailwind.config.ts`. No literal hex colors appear outside the root token block.
2. **Light-First Clarity with Dark-Mode Parity:** The default workspace uses a subtle slate canvas (`#f7f8fc`) paired with crisp white card surfaces (`#ffffff`). Dark mode switches atomically via `.dark` / `[data-theme="dark"]` using a pre-hydration inline script in `app/layout.tsx` to eliminate theme flash (FOUC).
3. **Honest Media UX:** No fabricated quality upsampling claims, no fake progress percentages, and no decorative status indicators. Technical measurements use tabular monospace typography (`.mono-metric`).
4. **Restrained Motion & Automatic Fallback:** Ambient hero lighting (`.muxaro-aurora-shell`) is implemented in pure CSS using strictly GPU-composited `transform` and `opacity` properties, automatically downgrading to a static gradient under `prefers-reduced-motion: reduce`, Lightweight mode (`[data-lightweight="true"]`), or background tabs (`[data-aurora-paused="true"]`).

---

## 2. Color Tokens (`apps/web/app/globals.css`)

### 2.1 Brand Palette

| Token | Value | Tailwind Mapping | Role |
| :--- | :--- | :--- | :--- |
| `--muxaro-indigo` | `#695bff` | `brand`, `brand-indigo`, `brand-violet` | Primary brand accent, focus rings, active links |
| `--muxaro-blue` | `#4677ff` | `brand-blue`, `info` | Secondary gradient stop, informational accents |
| `--muxaro-cyan` | `#36d6d1` | `brand-cyan` | Tertiary luminous gradient stop |
| `--muxaro-gradient-primary` | `linear-gradient(135deg, #695bff 0%, #4677ff 50%, #36d6d1 100%)` | `bg-muxaro-gradient` | Primary CTA buttons (`.muxaro-btn-primary`) |
| `--muxaro-gradient-hover` | `linear-gradient(135deg, #5b4de6 0%, #3b6bee 50%, #2cc5c0 100%)` | `bg-muxaro-gradient-hover` | Hover gradient state |
| `--muxaro-btn-fg` | `#ffffff` | `var(--muxaro-btn-fg)` | High-contrast text on primary brand buttons |

### 2.2 Semantic Surface, Border & Text Tokens

| Semantic Token | Light Theme (`:root`) | Dark Theme (`.dark` / `[data-theme="dark"]`) | Tailwind Utility |
| :--- | :--- | :--- | :--- |
| `--muxaro-bg-base` | `#f7f8fc` | `#0a0d14` | `bg-base` / `bg-main` |
| `--muxaro-bg-surface` | `#ffffff` | `#111520` | `bg-surface` |
| `--muxaro-bg-elevated` | `#f1f3f9` | `#181d2c` | `bg-surface-elevated` / `bg-elevated` |
| `--muxaro-bg-interactive` | `#eef1f8` | `#1f2538` | `bg-surface-muted` / `bg-interactive` |
| `--muxaro-border` | `#e8eaf1` | `#23293d` | `border-line` / `border-border` |
| `--muxaro-border-subtle` | `#f0f2f7` | `#1a1f2e` | `border-line-subtle` |
| `--muxaro-border-focus` | `#695bff` | `#695bff` | Focus ring outline (`2px solid`) |
| `--muxaro-text-primary` | `#171b2b` | `#f5f7fc` | `text-content` / `text-primary` |
| `--muxaro-text-secondary` | `#5e667e` | `#9aa8be` | `text-content-secondary` / `text-secondary` |
| `--muxaro-text-tertiary` | `#666e85` | `#7887a2` | `text-content-muted` / `text-tertiary` |

### 2.3 Status Semantic Tokens

| Status | Foreground Token | Foreground Hex | Background Token | Background Value |
| :--- | :--- | :--- | :--- | :--- |
| **Success** | `--muxaro-success` | `#10b981` | `--muxaro-success-bg` | `rgba(16, 185, 129, 0.1)` |
| **Warning** | `--muxaro-warning` | `#f59e0b` | `--muxaro-warning-bg` | `rgba(245, 158, 11, 0.1)` |
| **Error** | `--muxaro-error` | `#ef4444` | `--muxaro-error-bg` | `rgba(239, 68, 68, 0.1)` |
| **Info** | `--muxaro-info` | `#4677ff` | `--muxaro-info-bg` | `rgba(70, 119, 255, 0.1)` |

### 2.4 Contrast Compliance Summary

Text/surface token pairings are calibrated for WCAG 2.1 AA/AAA legibility in both themes:
- Primary text on light surface (`#171b2b` on `#ffffff`): `17.10:1` (AAA)
- Secondary text on light surface (`#5e667e` on `#ffffff`): `5.71:1` (AA)
- Tertiary text on light surface (`#666e85` on `#ffffff`): `5.05:1` (AA)
- Primary text on dark surface (`#f5f7fc` on `#111520`): `17.01:1` (AAA)
- Secondary text on dark surface (`#9aa8be` on `#111520`): `7.57:1` (AAA)
- White button foreground on indigo (`#ffffff` on `#695bff`): `4.62:1` (AA)

---

## 3. Typography (`apps/web/app/layout.tsx`)

Fonts are self-hosted via Next.js `next/font/google` (zero external `<link>` tags):

| Variable | Font | Configuration | Usage |
| :--- | :--- | :--- | :--- |
| `--font-sans` | **Inter** | `subsets: ['latin']`, `display: 'swap'` (preloaded) | All UI headings, body copy, navigation, buttons |
| `--font-mono` | **JetBrains Mono** | `subsets: ['latin']`, `display: 'swap'`, `preload: false` | Public User IDs (`MXR-*`), Job/Batch IDs, SHA-256 hashes, file sizes, durations, `.mono-metric` |

> **Why `JetBrains_Mono` has `preload: false`:** Preventing monospace font preload ensures `Inter` receives uncontested bandwidth priority on mobile 4G networks during initial hero render (LCP optimization).

### Heading & Metric Rules (`globals.css`)
- All headings (`h1`–`h4`) carry `overflow-wrap: break-word; min-width: 0;` to prevent horizontal overflow on narrow viewports.
- `h1` uses `font-weight: 800; line-height: 1.15; letter-spacing: -0.025em; text-wrap: balance;` (downgraded to `text-wrap: normal` when `[data-lightweight="true"]` is active to reduce Blink layout passes on low-end CPUs).
- `.mono-metric` enforces `font-variant-numeric: tabular-nums` so progress percentages, countdowns, and byte counts never jitter horizontally.

---

## 4. Radii, Elevation & Surface Primitives

### Border Radii (`tailwind.config.ts`)
- `sm`: `6px` (`--muxaro-radius-sm`) — Primary buttons, compact tags
- `md` / `DEFAULT`: `10px` (`--muxaro-radius-md`) — Standard cards (`.muxaro-card`)
- `lg`: `16px` (`--muxaro-radius-lg`) — Glass/elevated containers (`.glass-card`)
- `xl`: `20px`, `2xl`: `24px`, `3xl`: `32px`, `full`: `9999px` — Workspace hero shells and pill badges

### Shadows (`globals.css`)
- `--muxaro-shadow-sm`, `--muxaro-shadow-md`, `--muxaro-shadow-lg` scale smoothly between subtle dark-slate alpha (`0.04–0.08`) in light mode and deeper elevation (`0.3–0.5`) in dark mode.
- `--muxaro-shadow-btn` and `--muxaro-shadow-btn-hover` provide restrained indigo glow for primary CTAs.

### Shared Utility Classes (`globals.css`)
- `.muxaro-card` / `.muxaro-card-interactive`: Bordered surface cards with explicit `border-color` and `box-shadow` transitions (never `transition: all`).
- `.muxaro-btn-primary`: Gradient button with subtle `translateY(-1px)` hover lift and instant active press feedback.
- `.muxaro-aurora-shell` / `.muxaro-aurora-ribbon` / `.muxaro-aurora-glow`: Layered hero atmosphere reacting to focus (`.muxaro-aurora-focused`) and in-flight inspection (`.muxaro-aurora-analyzing`).

---

## 5. Accessibility & Interaction Standards

- **Focus Indicators:** Global `:focus-visible` rule (`outline: 2px solid var(--muxaro-border-focus); outline-offset: 2px`) plus Tailwind `focus-visible:ring-2 focus-visible:ring-brand-violet` on interactive elements.
- **Skip Navigation:** Root layout includes an accessible `<a href="#main-content">Skip to main content</a>` link revealed on keyboard focus.
- **Reduced Motion:** `@media (prefers-reduced-motion: reduce)` forces `scroll-behavior: auto`, disables Aurora animations/blur, and collapses transition/animation durations to `0.01ms`.
- **Horizontal Overflow Protection:** Both `html` and `body` enforce `overflow-x: clip` (never `100vw` or `overflow-x: hidden`, preserving `position: sticky` on `Navbar`).
