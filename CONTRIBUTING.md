# Contributing to MUXARO

Contributions to **MUXARO** are welcome across Web, Windows Desktop, Android Mobile, and the self-hostable API stack.

---

## Prerequisites

- **Node.js `24.x`** and **npm `>= 10`**
- **Optional (Desktop/Android native builds):** Android Studio JBR / JDK 21 + Android SDK (for `.apk` builds), `ffmpeg` / `yt-dlp`

---

## Local Setup

```bash
git clone https://github.com/SubhransuNayak007/muxaro.git
cd muxaro

# Install & run the Web Studio
npm --prefix apps/web ci
npm --prefix apps/web run dev
```

---

## Required Checks Before Opening a PR

```bash
# 1. TypeScript + Hallmark UI lint invariants
npm --prefix apps/web run lint

# 2. Local AI intent engine & desktop TypeScript checks
node --test apps/web/lib/ai/__tests__/intent-engine.test.mjs
npm --prefix apps/desktop run build:ts

# 3. Static production export check
STATIC_EXPORT=1 npm --prefix apps/web run build
```

---

## Coding & Design Standards

- Keep designs aligned with semantic tokens (`apps/web/app/globals.css`), never use `transition: all`, and respect `prefers-reduced-motion: reduce`.
- Keep subprocess execution (`ffmpeg`, `yt-dlp`, `whisper-cli`, `piper`) strictly `shell: false` with sanitized paths and explicit allowlists.
- Never commit `.env` secrets, user data, generated binaries (`.exe`, `.apk`), or local model weights.

---

## License for Contributions

By submitting a pull request, you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE).
