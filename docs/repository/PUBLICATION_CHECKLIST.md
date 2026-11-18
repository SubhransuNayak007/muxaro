# MUXARO GitHub Public Release Checklist

**Target Repository:** `https://github.com/SubhransuNayak007/muxaro` (`main`)  
**Chosen License:** `Apache-2.0`  
**Audit Date:** 2026-11-18  

Every **BLOCKER** gate below must show **PASS** before running `git init` / `git commit` / `git push` to a public GitHub repository.

---

## Gate 1: Secrets, Privacy & Sensitive Data

| # | Gate | Severity | Current Status | Verification Evidence / Required Action |
| :-: | :--- | :---: | :---: | :--- |
| 1.1 | Zero live API keys, OAuth secrets, R2 credentials, DB passwords, or private keys in trackable files | **BLOCKER** | **PASS** | Automated scan across all non-ignored files found 0 live secrets and 0 `.env`/`.pem`/`.key`/service-account JSON files. |
| 1.2 | Zero personal PII or private user emails in source or docs | **BLOCKER** | **PASS** | All 24 detected emails are synthetic test fixtures (`@example.com`, `@muxaro.test`) or role-based addresses (`support@`, `no-reply@`, `security@`, `dmca@`, `privacy@`, `legal@`). |
| 1.3 | `.gitignore` excludes ALL local runtime, DB, outbox, upload, artifact, and local tool state directories | **BLOCKER** | **FAIL** | **Action for `@ci-git`:** Add `.hallmark/` to `.gitignore` immediately! Currently `.muxaro-data/`, `.muxaro-artifacts/`, `.muxaro-uploads/`, `apps/api/.muxaro-*`, `*.db*`, `dev-outbox.jsonl`, `apps/web/out/`, `.next/` are ignored, **but `.hallmark/salt` is NOT ignored**. |
| 1.4 | Confirm no file > 100 MB (GitHub hard limit) or > 5 MB bloat will be staged | **BLOCKER** | **PASS (once `.gitignore` enforced)** | The 354.7 MB `.part` file (`apps/api/.muxaro-artifacts/...`) and 2.77 MB SQLite WAL (`apps/api/.muxaro-data/`) are ignored by `.gitignore`. Verify with `git status` & `git ls-files` before first commit. |
| 1.5 | Check AWS SigV4 test key (`AKIAIOSFODNN7EXAMPLE`) against GitHub Push Protection | **WARN** | **MONITOR** | `qa/harness/verify-r2-sigv4.ts:42,55` uses AWS's official documentation example key. Usually ignored by GitHub Secret Scanning, but verify during push. |
| 1.6 | Redact local Windows workspace path (`d:\yt doenlord`) in legacy docs | **RECOMMENDED** | **WARN** | Found in `docs/BUG_REGISTER.md:74` and `docs/architecture/system-overview.md:234`. Safe for security, recommended cleanup for polish. |
| 1.7 | Visually verify all captured README screenshots contain zero PII, live tokens, or error screens | **BLOCKER** | **PENDING (`@visuals` & `@verifier`)** | Must be verified before public push. |

---

## Gate 2: Licensing, Attribution & Legal Compliance

| # | Gate | Severity | Current Status | Verification Evidence / Required Action |
| :-: | :--- | :---: | :---: | :--- |
| 2.1 | Zero copyleft (`GPL`/`LGPL`/`AGPL`/`MPL`/`SSPL`) dependencies in JS/TS `package.json` / `node_modules` | **BLOCKER** | **PASS** | 274/274 resolved npm/pnpm packages are permissive (`MIT`, `ISC`, `Apache-2.0`, `BlueOak-1.0.0`, `BSD-3-Clause`, `CC-BY-4.0`, `0BSD`). |
| 2.2 | Root `LICENSE` file present and matches repository license choice | **BLOCKER** | **PASS** | Created `LICENSE` (`Apache-2.0`). |
| 2.3 | Root `NOTICE` file present (Apache-2.0 §4(d) + external CLI & trademark notices) | **BLOCKER** | **PASS** | Created `NOTICE`. |
| 2.4 | `THIRD_PARTY_NOTICES.md` accurately lists direct dependencies, non-MIT transitive packages, fonts (`OFL-1.1`), icons (`ISC`), and out-of-process FFmpeg/yt-dlp/container notices | **BLOCKER** | **PASS** | Created `THIRD_PARTY_NOTICES.md`. |
| 2.5 | Sub-package `package.json` `"license"` fields aligned with root `Apache-2.0` | **RECOMMENDED** | **WARN** | Currently mixed (`ISC`, `MIT`, `Apache-2.0`, `UNLICENSED`, omitted). Tracked in `REPOSITORY_AUDIT.md` for post-publication normalization PR. |

---

## Gate 3: Documentation, Truthfulness & Governance

| # | Gate | Severity | Current Status | Verification Evidence / Required Action |
| :-: | :--- | :---: | :---: | :--- |
| 3.1 | `README.md` uses real verified badges only (no fake stars/coverage/downloads) and matches `Apache-2.0` license | **BLOCKER** | **PENDING (`@visuals`)** | Must point strictly to `SubhransuNayak007/muxaro` real workflows and `Apache-2.0`. |
| 3.2 | Architecture, Backend, DB & API docs truthfully distinguish implemented SQLite / in-process queue / local FFmpeg+yt-dlp vs planned PostgreSQL / Redis / distributed worker / SMTP transport | **BLOCKER** | **PENDING (`@docs-core`, `@docs-ops`, `@verifier`)** | Verified against actual `apps/api/src/` code. |
| 3.3 | Community & governance files present (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `AUTHORS.md`, `CHANGELOG.md`, `CITATION.cff`) | **BLOCKER** | **PENDING (`@docs-ops`)** | Must include transparent Google Antigravity AI-assisted development attribution. |
| 3.4 | Repository audit docs complete (`REPOSITORY_AUDIT.md`, `PROJECT_INVENTORY.md`, `PUBLICATION_CHECKLIST.md`) | **BLOCKER** | **PASS** | Created in `docs/repository/`. |
| 3.5 | Zero broken relative Markdown links or invalid Mermaid syntax | **BLOCKER** | **PENDING (`@verifier`)** | Full link and Mermaid check before publication. |

---

## Gate 4: CI/CD, Workflows & Build Verification

| # | Gate | Severity | Current Status | Verification Evidence / Required Action |
| :-: | :--- | :---: | :---: | :--- |
| 4.1 | GitHub Actions workflows (`.github/workflows/`) use pinned action SHAs, least-privilege `permissions:`, and real scripts | **BLOCKER** | **PENDING (`@ci-git` & `@verifier`)** | Existing `ci-deploy.yml` uses unpinned `@v4`/`@v3`/`@v2` tags and `|| true` on typecheck/audit; CI suite must be hardened. |
| 4.2 | Local build, typecheck, and automated test suites pass | **BLOCKER** | **PENDING (`@verifier`)** | Confirm Web build, API tests, Security tests, and Entitlements/Adapter tests pass. |
| 4.3 | `.env.example` contains placeholders only and documents all required env vars | **BLOCKER** | **PASS** | Root `.env.example` audited clean (0 real secrets). |

---

## Gate 5: Git Initialization, Signing & GitHub Publication

| # | Gate | Severity | Current Status | Verification Evidence / Required Action |
| :-: | :--- | :---: | :---: | :--- |
| 5.1 | Initialize Git repo on `main` branch (`git init -b main`) | **BLOCKER** | **PENDING** | Workspace is not yet a Git repo; system default is `master`, so `-b main` is mandatory. |
| 5.2 | Configure Git `user.name` and `user.email` before committing | **BLOCKER** | **PENDING** | Neither is currently set in `~/.gitconfig`. |
| 5.3 | Commit signing decision (SSH signing vs unsigned) | **RECOMMENDED** | **WARN** | GPG is not installed; `~/.ssh` has no keys; `ssh-keygen.exe` is available on Windows if signed commits are desired before pushing. |
| 5.4 | Dry-run staged file list inspection (`git status` + verify zero `.muxaro-*`, `.hallmark`, `node_modules`, `.next`, `out`, `*.db*`) | **BLOCKER** | **PENDING** | Run immediately before `git commit`. |
| 5.5 | Create GitHub repo `SubhransuNayak007/muxaro` (confirmed does not yet exist) and push `main` | **BLOCKER** | **PENDING** | `gh` CLI is authenticated as `SubhransuNayak007` with `repo` & `workflow` scopes. |

---

## Gate 6: Post-Publication GitHub Repository Hardening

Execute immediately after the repository is live on GitHub:
1. Enable **Branch Protection / Ruleset** on `main` (require pull requests, required CI status checks, block force-pushes and branch deletion).
2. Enable **GitHub Secret Scanning** and **Push Protection**.
3. Enable **Dependabot Alerts** and **Dependabot Security Updates**.
4. Configure protected GitHub Environments (`staging` and `production` with required reviewers) before adding any Cloudflare or Google Cloud WIF deployment secrets.
5. Plan a follow-up cleanup PR for non-blocking hygiene items: deduplicating the 3 identical 1 MB PNGs in `apps/web/public/brand/`, normalizing sub-package `"license"` fields to `"Apache-2.0"`, fixing broken scripts in `tests/package.json` & `security/package.json`, and removing legacy `@vyro/*` aliases.
