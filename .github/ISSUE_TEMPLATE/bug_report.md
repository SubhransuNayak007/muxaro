---
name: Bug Report
description: Report a reproducible defect or unexpected behavior in MUXARO
title: "[Bug]: "
labels: ["bug", "triage"]
---

## Summary
A clear, concise description of the bug.

## Affected Component
Select all that apply:
- [ ] Web App (`apps/web`)
- [ ] REST & SSE API (`apps/api`)
- [ ] FFmpeg Media Worker (`apps/media-worker`)
- [ ] Entitlements & Quota Engine (`packages/entitlements`)
- [ ] Source Adapters (`packages/source-adapters`)
- [ ] Security Module (`security`)
- [ ] Infrastructure / Docker / Deployment (`infra`)

## Steps to Reproduce
1. Go to '...'
2. Run command or send request '...'
3. Observe error '...'

## Expected Behavior
Describe what you expected to happen.

## Actual Behavior
Describe what happened instead. Include sanitized error responses or stack traces.

> **Privacy Reminder:** Never paste real API keys, OAuth secrets, session cookies, `.env` contents, or personal data into public issues.

```text
Paste sanitized logs or error output here
```

## Environment
- OS: (e.g., Windows 11, macOS 15, Ubuntu 24.04)
- Node.js version: (output of `node -v`)
- FFmpeg / FFprobe version (if applicable):
- Browser (if UI issue):
- Deployment mode: (local dev / Docker Compose / Cloud Run + Cloudflare Pages)

## Additional Context
Add any other context, sample non-sensitive payloads, or screenshots.
