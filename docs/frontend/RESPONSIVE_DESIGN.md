# MUXARO Responsive Design & Viewport Strategy

MUXARO is designed mobile-first using Tailwind CSS breakpoints (`apps/web/tailwind.config.ts`) and tested across mobile (`375px` / `390px`), tablet (`768px`), laptop (`1280px`), and desktop (`1536px+`) viewports.

---

## 1. Breakpoint System (`apps/web/tailwind.config.ts`)

| Token | Min Width | Layout Behaviour |
| :--- | :--- | :--- |
| Base (`< 640px`) | `0px` | Single-column stacked workspace, mobile drawer nav (`Menu`/`X` toggle), full-width CTAs, compact icon-only theme/lightweight controls |
| `sm` | `640px` | Inline auth buttons (`Sign in` / `Create free account`), visible live credits pill in navbar, horizontal action rows in `JobProgress` and `ConsentBanner`, 2-column footer grid |
| `md` | `768px` | 4-column footer (`md:grid-cols-4`), side-by-side capability and inspector layouts |
| `lg` | `1024px` | Full desktop center navigation links (`hidden lg:flex`), mobile drawer hidden (`lg:hidden`), generous `lg:px-8` container gutters |
| `xl` | `1280px` | Container capped at `max-w-sheet` (`1280px`) and centered horizontally |
| `2xl` | `1536px+` | Container remains capped at `1280px` with balanced outer gutters (zero stretched line lengths) |

---

## 2. Container & Overflow Guardrails

1. **Centered Sheet Width (`max-w-sheet`):** Configured in `tailwind.config.ts` as `1280px`. `Navbar`, `Footer`, and primary workspace sections use `max-w-sheet mx-auto px-4 sm:px-6 lg:px-8` so content stays legible on ultrawide monitors (`1920px+`).
2. **Zero Horizontal Scroll (`overflow-x: clip`):** Declared on both `html` and `body` in `apps/web/app/globals.css`. Using `clip` rather than `hidden` prevents accidental horizontal overflow from ambient Aurora ribbons while keeping `position: sticky` working reliably on `Navbar`.
3. **Word-Wrap & Grid Safety:** All heading levels (`h1`–`h4`) specify `overflow-wrap: break-word; min-width: 0;`, and flex/grid containers holding filenames, URLs, or `MXR-*` / `MXJ-*` identifiers apply `min-w-0` + `truncate` so long filenames never blow out mobile widths.

---

## 3. Navigation Adaptation (`apps/web/components/Navbar.tsx`)

| Viewport | Brand | Primary Links | Auth & Credits | Utility Controls |
| :--- | :--- | :--- | :--- | :--- |
| **Mobile (`< 640px`)** | Mark + `MUXARO` | Inside `#mobile-nav-drawer` | Auth buttons / account summary inside mobile drawer | Lightweight toggle + Theme toggle + Menu button |
| **Small Tablet (`640px–1023px`)** | Mark + `MUXARO` | Inside `#mobile-nav-drawer` | Credits pill + Account dropdown (or Sign in / Create free account) in header | Lightweight toggle + Theme toggle + Menu button |
| **Desktop (`>= 1024px`)** | Mark + `MUXARO` | Centered 5-link bar (`Home`, `Tools`, `My Downloads`, `Usage`, `Account`) | Credits pill + Account dropdown (with `Admin` item if admin) | Lightweight toggle + Theme toggle |

- Mobile drawer and account dropdown both close automatically on route change (`usePathname()`), `Escape` key (restoring focus to the trigger button), and outside `pointerdown`.

---

## 4. Workspace & Media Controls on Touch Devices

- **Above-the-Fold Hero Discipline:** The hero headline, subtitle, and URL/Upload input workspace fit cleanly inside standard laptop (`1280×800`) and mobile viewports without scrolling past marketing filler.
- **Tap-Friendly Action Rows:** Primary actions in `JobProgress` (`Download video/audio`, `Save in background`, `Process another`), `RewardedAdCard`, and `ConsentBanner` use `flex-col sm:flex-row` and `whitespace-nowrap` so buttons stack full-width on narrow screens and align horizontally on larger screens.
- **Bandwidth-Conscious Media Preview:** In `JobProgress.tsx`, `<video>` and `<audio>` previews stay unmounted behind an explicit **Preview** button (`preload="metadata"`), preventing automatic cellular data consumption on mobile screens.
- **Responsive Privacy Banner:** `ConsentBanner.tsx` anchors cleanly via `fixed bottom-4 inset-x-4` with `max-w-3xl` centering so it never clips off narrow viewports.
