# Third-Party Notices & License Attribution

**Project:** MUXARO (`SubhransuNayak007/muxaro`)  
**Repository License:** Apache License, Version 2.0 (`Apache-2.0`) — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE)  
**Audit Date:** 2026-11-18  

This document lists all verified third-party packages, fonts, icons, external CLI tools, and container dependencies used by MUXARO, as audited directly from the workspace `package.json` manifests, installed `node_modules` trees, frontend typography/icon declarations, and Dockerfiles.

---

## 1. License Compatibility Summary

An automated scan of all installed packages across the monorepo (`apps/api`, `apps/media-worker`, `apps/web`, `packages/entitlements`, `packages/source-adapters`) resolved **274 unique `package@version` entries**:

| SPDX License | Unique Packages | Compatibility with `Apache-2.0` |
| :--- | :---: | :--- |
| `MIT` | 217 | Fully compatible (permissive) |
| `ISC` | 20 | Fully compatible (permissive) |
| `Apache-2.0` | 19 | Identical license |
| `BlueOak-1.0.0` | 10 | Fully compatible (modern permissive) |
| `BSD-3-Clause` | 6 | Fully compatible (permissive) |
| `CC-BY-4.0` | 1 (`caniuse-lite`) | Compatible (attribution retained below) |
| `0BSD` | 1 (`tslib`) | Fully compatible (zero-clause permissive) |
| **Copyleft (`GPL` / `LGPL` / `AGPL` / `MPL` / `SSPL`)** | **0** | **None present in JS/TS dependency tree** |
| **Unknown / Unlicensed** | **0** | **All packages verified** |

> **Verification note on legacy metadata fields:** Two transitive packages under `apps/web/node_modules` (`busboy@1.6.0` and `streamsearch@1.1.0` by Brian White) use the deprecated npm `"licenses"` array instead of `"license"`. Their on-disk `LICENSE` files were verified directly as **MIT**.

---

## 2. Direct Dependencies by Workspace Package

### 2.1 `apps/api` (`@muxaro/api`)

| Package | Declared Range | Resolved Version | License | Role |
| :--- | :--- | :--- | :--- | :--- |
| `fastify` | `^5.12.8` | `5.12.8` | `MIT` | HTTP / REST / SSE server framework |
| `@fastify/cors` | `^11.4.3` | `11.4.3` | `MIT` | Origin-restricted CORS with credentials |
| `@fastify/sensible` | `^6.0.8` | `6.0.8` | `MIT` | Standard HTTP error utilities |
| `@fastify/swagger` | `^9.9.5` | `9.9.5` | `MIT` | OpenAPI 3 specification generation |
| `@fastify/swagger-ui` | `^6.1.4` | `6.1.4` | `MIT` | Interactive Swagger UI at `/docs` |
| `@types/node` *(dev)* | `^26.6.6` | `26.6.6` | `MIT` | Node.js TypeScript definitions |
| `tsx` *(dev)* | `^4.23.15` | `4.23.15` | `MIT` | TypeScript runtime & test execution |
| `typescript` *(dev)* | `^7.0.2` | `7.0.2` | `Apache-2.0` | TypeScript compiler |

*(Built-in Node 24 standard library modules used directly without third-party drivers: `node:sqlite`, `node:crypto`, `node:child_process`, `node:fs`, `node:events`, `node:path`.)*

### 2.2 `apps/media-worker` (`@muxaro/media-worker`)

| Package | Declared Range | Resolved Version | License | Role |
| :--- | :--- | :--- | :--- | :--- |
| `archiver` | `^7.0.1` | `7.0.1` | `MIT` | Streaming ZIP packaging for playlists/batches |
| `fastify` | `^5.2.1` | `5.12.8` | `MIT` | Worker HTTP server |
| `zod` | `^3.24.2` | `3.25.76` | `MIT` | Request schema validation |
| `@types/archiver` *(dev)* | `^6.0.3` | `6.0.4` | `MIT` | TypeScript definitions for `archiver` |
| `@types/node` *(dev)* | `^22.13.4` | `22.20.5` | `MIT` | Node.js TypeScript definitions |
| `tsx` *(dev)* | `^4.19.3` | `4.23.15` | `MIT` | TypeScript execution |
| `typescript` *(dev)* | `^5.7.3` | `5.9.3` | `Apache-2.0` | TypeScript compiler |

### 2.3 `apps/web` (`@muxaro/web`)

| Package | Declared Range | Resolved Version | License | Role |
| :--- | :--- | :--- | :--- | :--- |
| `next` | `^14.2.24` | `14.2.24` | `MIT` | React framework (App Router & static export) |
| `react` | `^18.3.1` | `18.3.1` | `MIT` | UI component library |
| `react-dom` | `^18.3.1` | `18.3.1` | `MIT` | React DOM renderer |
| `lucide-react` | `^0.453.0` | `0.453.0` | `ISC` | Iconography (derived from Feather Icons, MIT) |
| `clsx` | `^2.1.1` | `2.1.1` | `MIT` | Conditional CSS class composition |
| `tailwind-merge` | `^2.5.4` | `2.6.1` | `MIT` | Tailwind utility class deduplication |
| `tailwindcss` *(dev)* | `^3.4.14` | `3.4.19` | `MIT` | Utility-first CSS framework |
| `postcss` *(dev)* | `^8.4.47` | `8.5.33` | `MIT` | CSS transformation pipeline |
| `autoprefixer` *(dev)* | `^10.4.20` | `10.6.2` | `MIT` | Vendor prefix generation |
| `typescript` *(dev)* | `^5.6.3` | `5.9.3` | `Apache-2.0` | TypeScript compiler |
| `@types/node` *(dev)* | `^20.17.0` | `20.19.43` | `MIT` | Node.js TypeScript definitions |
| `@types/react` *(dev)* | `^18.3.11` | `18.3.31` | `MIT` | React TypeScript definitions |
| `@types/react-dom` *(dev)* | `^18.3.1` | `18.3.7` | `MIT` | React DOM TypeScript definitions |

### 2.4 Internal Workspace Packages (`packages/`, `security/`, `tests/`)

- `packages/entitlements` (`@muxaro/entitlements`): Zero runtime dependencies; devDependencies `@types/node@^26.6.6` (`MIT`), `typescript@^7.0.2` (`Apache-2.0`).
- `packages/source-adapters` (`@muxaro/source-adapters`): Zero runtime dependencies; devDependencies `@types/node@^26.6.6` (`MIT`), `typescript@^7.0.2` (`Apache-2.0`).
- `security` (`@muxaro/security`): Zero external dependencies (pure Node.js standard library).
- `tests` (`@vyro/tests`, legacy name): Zero external dependencies (uses Node.js built-in `node:test` and `node:assert`).

---

## 3. Notable Non-MIT / Non-Apache / Non-ISC Transitive Attributions

The following transitive packages carry attribution-sensitive permissive licenses and are explicitly acknowledged here:

| Package | Version | License | Notes |
| :--- | :--- | :--- | :--- |
| `caniuse-lite` | `1.0.30001826` | `CC-BY-4.0` | Browser compatibility dataset by Alexis Deveria / Can I Use (used by `autoprefixer` / `browserslist`) |
| `tslib` | `2.9.1` | `0BSD` | Microsoft TypeScript runtime helpers |
| `fast-uri` | `3.1.9`, `4.2.3` | `BSD-3-Clause` | Fastify URI parser |
| `light-my-request` | `6.8.1` | `BSD-3-Clause` | Fastify HTTP injection helper |
| `secure-json-parse` | `4.1.1` | `BSD-3-Clause` | Fastify prototype-pollution-safe JSON parser |
| `ieee754` | `1.2.1` | `BSD-3-Clause` | IEEE 754 floating-point read/write utilities |
| `source-map-js` | `1.2.2` | `BSD-3-Clause` | Source map generation/consumption (PostCSS) |
| `glob`, `lru-cache`, `minimatch`, `minipass`, `path-scurry`, `graceful-fs`, `jackspeak`, `package-json-from-dist`, `@isaacs/nonrecursive-glob-match` | Various | `BlueOak-1.0.0` | Permissive Blue Oak Model License 1.0.0 utilities |

---

## 4. Fonts, Icons & Visual Assets

| Asset | Source | License | Where Used |
| :--- | :--- | :--- | :--- |
| **Inter** typeface | Google Fonts (`next/font/google`) | `OFL-1.1` (SIL Open Font License 1.1) | `apps/web/app/layout.tsx` (`--font-sans`) |
| **JetBrains Mono** typeface | Google Fonts (`next/font/google`) | `OFL-1.1` (SIL Open Font License 1.1) | `apps/web/app/layout.tsx` (`--font-mono`) |
| **Lucide Icons** (`lucide-react`) | Lucide Contributors (derived from Feather Icons) | `ISC` (Portions `MIT`) | `apps/web/components/` and `apps/web/app/` |
| **MUXARO Brand Marks** (`apps/web/public/brand/*`) | Original project assets | Owned by MUXARO (see `NOTICE` §3 for trademark notice) | Web app header, favicon, OpenGraph cards |
| **Synthetic Test Media Fixtures** (`tests/media/fixtures/*`) | Synthesized programmatically via FFmpeg `lavfi` test generators (`tests/media/synthetic-generator.ts`) | Project test fixtures (`Apache-2.0`) | Automated media engine tests |

---

## 5. External System Binaries & Container Dependencies (Out-of-Process Only)

Per [`docs/architecture/adr/ADR-001-clean-room-gpl-isolation.md`](./docs/architecture/adr/ADR-001-clean-room-gpl-isolation.md) and [`docs/architecture/adr/ADR-003-media-pipeline-ffmpeg-execution.md`](./docs/architecture/adr/ADR-003-media-pipeline-ffmpeg-execution.md), MUXARO **never** incorporates, statically links, or dynamically links copyleft source code or shared libraries (`libavcodec`, `libavformat`, etc.) into its TypeScript/Node.js processes.

| External Tool | Invocation Boundary | Upstream License | Distribution & Compliance Notes |
| :--- | :--- | :--- | :--- |
| **FFmpeg & FFprobe** (`https://ffmpeg.org/`) | Invoked exclusively as external OS child processes (`child_process.execFile` / `spawn` with argument arrays, `shell: false`) in `apps/api` and `apps/media-worker`. | Upstream `LGPL-2.1+` or `GPL-2.0+` / `GPL-3.0` depending on compile flags. Debian Bookworm's `ffmpeg` package is compiled with `--enable-gpl --enable-version3` (**GPL-3.0**). | **Not bundled in this Git repository.** Operators who build and distribute container images using `infra/Dockerfile.api`, `infra/Dockerfile.worker`, or `infra/Dockerfile.media` are distributing Debian's GPL-3.0 `ffmpeg` binary layer and must preserve FFmpeg/Debian license notices and corresponding source availability for those container layers. |
| **yt-dlp** (`https://github.com/yt-dlp/yt-dlp`) | Invoked exclusively as an external OS child process (`execFile` / `spawn`, `shell: false`) in `apps/api/src/services/adapter.service.ts`, `queue.service.ts`, and `routes/playlists.ts`. | **The Unlicense** (public domain dedication). | Downloaded at Docker build time from official GitHub releases or provided by the host environment. Not bundled in this Git repository. |
| **Container Base Images & OS Utilities** | `node:24-bookworm-slim`, `node:20-bookworm-slim`, `node:20-alpine`, `postgres:16-alpine`, `redis:7-alpine`, `minio/minio`, `tini`, `curl`, `python3`, `ca-certificates`. | Respective upstream open-source licenses (`MIT`, `Apache-2.0`, `PostgreSQL`, `BSD-3-Clause`, `AGPL-3.0` for MinIO local dev container, `PSF-2.0`, `GPL` for Debian base utilities). | Referenced only in `infra/Dockerfile.*` and `infra/docker-compose.yml` for containerized deployment and local development. Note: `minio/minio` in `infra/docker-compose.yml` is licensed under **AGPL-3.0** and is used solely as an optional local S3 emulator (production object storage targets Cloudflare R2 via pure-Node AWS SigV4). |

---

## 6. Clean-Room Provenance Statement

No source code, extraction scripts, regex tables, or binaries from GPL-licensed desktop media utilities (such as the reference systems analyzed conceptually in `docs/REFERENCE_AUDIT.md`) were copied or imported into MUXARO. All TypeScript services, route handlers, security guards, entitlement engines, and frontend components are clean-room implementations authored for MUXARO.
