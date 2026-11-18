# ADR-004: Monorepo Structure & Technology Stack Selection

**Status:** Accepted  
**Deciders:** Principal Architect (AGENT 01), Frontend Engineer (AGENT 02), Backend Engineer (AGENT 03)  
**Date:** 2026-11-18  

---

## 1. Context and Problem Statement
The MUXARO media platform (formerly Project VYRO) comprises multiple intersecting sub-systems:
1. Public-facing web application with SEO requirements, documentation, and real-time reactive UI.
2. High-throughput REST and Server-Sent Events API Gateway.
3. Media worker daemon executing out-of-process FFmpeg tasks.
4. Shared domain logic: source adapters, quota calculations, security guards, and TypeScript types.

We need a unified workspace structure that enables independent deployment of containers, maximum code sharing without circular dependencies, sub-millisecond API response overhead, and strict type safety.

---

## 2. Alternatives Considered

### 2.1 Backend Framework: Fastify vs Express vs NestJS vs Go
- **Express:** Legacy standard, but sluggish JSON serialization, unmaintained core, poor native async/await error propagation, lacks schema-based serialization.
- **NestJS:** Excessive OOP boilerplate and dependency injection overhead for what is fundamentally a high-throughput stream and queue gateway.
- **Go (Golang):** Excellent raw concurrency, but splits language ecosystem across frontend and backend, preventing direct sharing of validation schemas, source adapter interfaces, and TypeScript DTOs.
- **Fastify:** High throughput (up to 4x faster than Express), built-in Ajv schema compilation, fast-json-stringify, native plugin encapsulation, and first-class async handling. **Selected for `apps/api`.**

### 2.2 Frontend Framework: Next.js 14 App Router vs Vite/React SPA
- **Vite SPA:** Fast client rendering, but lacks native server-side rendering (SSR) and dynamic OpenGraph generation required for SEO discoverability, documentation indexation, and social card unfurling.
- **Next.js 14 (App Router):** First-class SSR and static page generation for `/docs` and `/legal`, paired with client components for real-time media inspection and queue streaming. **Selected for `apps/web`.**

---

## 3. Decision
We establish a **TypeScript Strict Monorepo** structured as follows:

```
apps/
  api/            # Fastify 4.x Node.js LTS (Port 4000)
  web/            # Next.js 14 App Router + Tailwind CSS (Port 3000)
  media-worker/   # Node.js LTS Worker Daemon (BullMQ + FFmpeg)
packages/
  source-adapters/# Clean TypeScript interfaces & adapters
  entitlements/   # Quota math, rolling window, credit ledger
security/         # SSRFGuard, CIDR sanitizers, argument escaping
infra/            # Docker, Compose, Terraform, Kubernetes manifests
```

### Shared Standards:
1. **TypeScript Strictness:** `"strict": true`, `"noImplicitAny": true`, `"exactOptionalPropertyTypes": true`.
2. **Schema-Driven Contracts:** Shared DTOs and validation schemas compiled from OpenAPI 3.1 definitions.
3. **No Cross-App Imports:** Applications in `apps/` must never import directly from another app in `apps/`. All shared utilities, types, and logic must reside in `packages/` or `security/`.

---

## 4. Consequences

### Positive:
- End-to-end type safety from database models to frontend components.
- Sub-millisecond routing and serialization in `apps/api`.
- Pristine SEO indexing for public pages in `apps/web` while preserving interactive desktop-grade utility speed.
- Microservice deployment independence: `apps/web`, `apps/api`, and `apps/media-worker` build into distinct Docker containers.

### Negative:
- Monorepo tooling setup (Turborepo / pnpm workspace) requires disciplined build cache management.
