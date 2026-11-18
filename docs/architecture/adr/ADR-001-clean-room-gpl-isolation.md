# ADR-001: Clean-Room Software Architecture & GPL-3.0 Copyleft Isolation

**Status:** Accepted  
**Deciders:** Principal Architect (AGENT 01), SRE (AGENT 07), Security Engineer (AGENT 08)  
**Date:** 2026-11-18  

---

## 1. Context and Problem Statement
Media utilities frequently leverage open-source desktop codebases such as YoutubeGO, yt-dlp wrappers, and GPL-licensed conversion scripts. However, YoutubeGO and similar desktop tools are licensed strictly under the **GNU General Public License v3.0 (GPL-3.0)**. 

If proprietary, dual-licensed, or permissively licensed (MIT / Apache-2.0) cloud software incorporates, statically links, or dynamically links GPL-3.0 source code, the viral provisions of GPL-3.0 mandate that the entire derivative work and downstream services be licensed under GPL-3.0, with full source code disclosure upon conveyance.

MUXARO (formerly Project VYRO) must operate as an independent, enterprise-grade cloud service with proprietary and commercial flexibility, completely free from legal claims of copyleft contamination or copyright infringement.

---

## 2. Decision
We enforce a strict **Clean-Room Engineering Protocol**:

1. **Complete Code Segregation:** Zero lines of code, regex tables, or proprietary structures from YoutubeGO or any GPL-3.0 repository may be copied, referenced, or imported into this monorepo.
2. **Black-Box Functional Specifications:** All implementations in `apps/` and `packages/` must be authored strictly from first principles and publicly documented standards (RFC 7231 HTTP/1.1, RFC 6455 WebSockets, OpenAPI 3.1, official FFmpeg/FFprobe documentation).
3. **Out-of-Process Execution Boundary:** Any system utility that carries a GPL license (such as standard FFmpeg/FFprobe binaries) must run strictly as an out-of-process system binary via OS execution (`child_process.execFile`) across standard system pipes (`stdio`, `stdin`, `stderr`). 
   - No direct in-process C-binding linking (e.g. `libavcodec.so` via node-gyp or CGO) is permitted.
   - Under established Free Software Foundation (FSF) legal doctrine, separate address space execution communicating over standard IPC does not create a derivative work under copyright law.
4. **Dependency Auditing:** Every package in `package.json` must carry an approved permissive license (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0). GPL dependencies are rejected by automated CI license checkers.

---

## 3. Consequences

### Positive:
- Total legal immunity from copyleft contamination and licensing disputes.
- Retains full commercial freedom, dual-licensing rights, and IP defensibility.
- Encourages modular, clean-slate TypeScript design tailored specifically for cloud multi-tenancy rather than single-user desktop assumptions.

### Negative:
- Inability to copy pre-baked desktop extraction scripts or convenience libraries.
- Requires building and maintaining our own TypeScript source adapter layer (`packages/source-adapters/`).
