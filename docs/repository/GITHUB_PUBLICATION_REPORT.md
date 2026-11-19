# MUXARO — GitHub Publication Report

> **Repository:** [`SubhransuNayak007/muxaro`](https://github.com/SubhransuNayak007/muxaro)  
> **Default Branch:** `main`  
> **Visibility:** Public  
> **License:** Apache License 2.0 (`Apache-2.0`)  
> **Publication Date (UTC):** `2026-11-18`

---

## 1. Repository Metadata & Configuration

Verified live via `gh api repos/SubhransuNayak007/muxaro`:

| Property | Verified Live Value |
| :--- | :--- |
| Full Name | `SubhransuNayak007/muxaro` |
| HTML URL | `https://github.com/SubhransuNayak007/muxaro` |
| Live Frontend Homepage | `https://muxaro.pages.dev/` (verified live Cloudflare Pages deployment) |
| Visibility | `public` |
| Default Branch | `main` |
| SPDX License | `Apache-2.0` |
| Description | `MUXARO — Your Media. One Powerful Workspace. Self-hostable full-stack media processing platform built with Next.js 14, Fastify 5, Node.js 24, and FFmpeg.` |
| Topics | `media-processing`, `ffmpeg`, `typescript`, `nextjs`, `fastify`, `sqlite`, `cloudflare-r2`, `open-source` |
| Issues | Enabled (`has_issues: true`) |
| Discussions | Enabled (`has_discussions: true`) |
| Delete Branch on Merge | Enabled (`delete_branch_on_merge: true`) |
| Tracked Files (at `v0.1.0`) | `449` tracked files (largest file: `assets/animations/muxaro-demo.gif`, 1.22 MB) |

---

## 2. Git History, Authorship & Commit Signing Status

- **Author / Committer Identity:** `SubhransuNayak007 <209996646+SubhransuNayak007@users.noreply.github.com>` (official GitHub account noreply address; no fabricated emails or contributors).
- **Commit Signing Status (Honest Disclosure):** Commits in this initial publication are **unsigned** because neither GPG nor an SSH signing key (`~/.ssh`) was configured on the workstation at publication time. Maintainer can enable SSH commit signing (`git config --global gpg.format ssh`) and register a GitHub Signing Key in a follow-up step.
- **Verified Commit Log (through `v0.1.0`):**

| Commit | Timestamp | Message |
| :--- | :--- | :--- |
| `9563bc4` | `2026-11-18T15:22:30+05:30` | `feat: MUXARO full platform ready for Cloudflare Pages, R2 & Cloud Run` |
| `8bdbb94` | `2026-11-18T15:29:03+05:30` | `fix(entitlements): anchor runtime storage gitignore and track entitlements storage module` |
| `e2a005e` | `2026-11-18T15:29:03+05:30` | `fix(ci): grant actions read permission for Trivy SARIF upload and scope Gitleaks test allowlist` |
| `0af394c` | `2026-11-18T15:29:03+05:30` | `docs: align README API/test commands and scrub local workspace path from bug register` |

---

## 3. GitHub Security Features & Branch Protection

### Security & Analysis (`gh api repos/SubhransuNayak007/muxaro`)
- **Secret Scanning:** `enabled` (**0 open alerts**)
- **Secret Scanning Push Protection:** `enabled`
- **Dependabot Alerts (Vulnerability Alerts):** `enabled`
- **Dependabot Security Updates (Automated Fixes):** `enabled`
- **Dependabot Version Updates:** Active via [`.github/dependabot.yml`](../../.github/dependabot.yml) (`github-actions`, `docker` in `/infra`, and `npm` across `/apps/web`, `/apps/api`, `/apps/media-worker`, `/packages/entitlements`, `/packages/source-adapters`)
- **Code Scanning (CodeQL + Trivy SARIF):** Active on `main` and PRs

### Branch Protection on `main` (`gh api repos/SubhransuNayak007/muxaro/branches/main/protection`)
- **Allow Force Pushes:** `false`
- **Allow Deletions:** `false`
- **Require Conversation Resolution:** `true`
- **Pull Request Reviews:** `1` approving review required, `dismiss_stale_reviews: true`, `require_code_owner_reviews: true` (backed by [`.github/CODEOWNERS`](../../.github/CODEOWNERS))
- **Required Status Checks (`strict: true`, GitHub Actions `app_id: 15368`):**
  1. `TypeCheck & Static Invariants`
  2. `Unit, Concurrency & Security Tests`
  3. `Media Worker & API Integration Tests`
  4. `Build Static Frontend & Verify Containers`
  5. `Secret & Credential Scan`
  6. `API Runtime Dependency Audit`
- **Enforce Admins:** `false` (allows repository owner emergency/release housekeeping while keeping PR, review, force-push, and deletion guardrails active)

---

## 4. Live GitHub Actions Workflow Verification

All production workflows use least-privilege `permissions:`, zero error swallowing (`|| true`), and 40-character commit-SHA pinning across all third-party GitHub Actions.

| Workflow | File | Run ID | Ref | Conclusion | Run URL |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CI | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | `44281014380` | `main` (`0af394c`) | `success` | [View Run](https://github.com/SubhransuNayak007/muxaro/actions/runs/44281014380) |
| Security | [`.github/workflows/security.yml`](../../.github/workflows/security.yml) | `44281014146` | `main` (`0af394c`) | `success` | [View Run](https://github.com/SubhransuNayak007/muxaro/actions/runs/44281014146) |
| CodeQL | [`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml) | `44281014175` | `main` (`0af394c`) | `success` | [View Run](https://github.com/SubhransuNayak007/muxaro/actions/runs/44281014175) |
| Deploy Staging | [`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml) | `44280042827` | `main` (`9563bc4`) | `success` | [View Run](https://github.com/SubhransuNayak007/muxaro/actions/runs/44280042827) |
| Release | [`.github/workflows/release.yml`](../../.github/workflows/release.yml) | `44281748834` | `v0.1.0` (`0af394c`) | `success` | [View Run](https://github.com/SubhransuNayak007/muxaro/actions/runs/44281748834) |

> **Note on Deploy Workflows:** `.github/workflows/deploy-staging.yml` and `.github/workflows/deploy-production.yml` are configured with protected `staging`/`production` environments and OIDC Workload Identity Federation for Google Cloud. The live frontend is currently deployed on Cloudflare Pages at [`https://muxaro.pages.dev/`](https://muxaro.pages.dev/) (verified HTTP `200`, `301` HTTP→HTTPS redirect, `TLSv1.3` / `TLS_AES_256_GCM_SHA384`, Let's Encrypt certificate `CN=muxaro.pages.dev` valid `2026-11-18` → `2027-02-16`, zero mixed content; see [`docs/deployment/SSL_TLS.md`](../deployment/SSL_TLS.md)). Live GitHub Actions deploy uploads and custom domain (`muxaro.app` / `api.muxaro.app`) / Cloud Run backend provisioning remain safely gated until deployment secrets are configured in GitHub Environments.

---

## 5. Issues Resolved During Live Publication

1. **Unanchored `storage/` pattern in `.gitignore`:** Excluded `packages/entitlements/src/storage/` from the initial commit (`9563bc4`), causing `CI` run `44280042939` to fail on `packages/entitlements` typecheck and API integration tests. Fixed in `8bdbb94` by anchoring `/storage/` and `apps/api/storage/` and committing the missing source files.
2. **Trivy SARIF Upload Permission & Private Repo Visibility:** `github/codeql-action/upload-sarif` requires `actions: read` alongside `security-events: write`, and GitHub Code Scanning requires public visibility (or GHAS). Fixed in `e2a005e` and by publishing the repository publicly.
3. **Gitleaks False Positives on Non-Secret Test Strings:** Scoped `.github/gitleaks.toml` with `condition = "AND"` paired strictly to exact file paths and benign literal strings (UI consent storage key and unit test idempotency/scrubber fixtures) in `e2a005e`.
4. **Local Workspace Path Scrubbed:** Removed Windows local path reference from [`docs/BUG_REGISTER.md`](../BUG_REGISTER.md) in `0af394c`.
