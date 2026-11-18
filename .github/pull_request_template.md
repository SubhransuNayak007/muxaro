## Summary
Describe the changes introduced in this pull request and why they are needed.

## Related Issues
Closes #(issue)

## Type of Change
- [ ] Bug fix (non-breaking change that resolves an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature causing existing behavior or API contracts to change)
- [ ] Security hardening or vulnerability fix
- [ ] Documentation or CI/CD improvement
- [ ] Refactoring or performance optimization

## Affected Areas
- [ ] `apps/web`
- [ ] `apps/api`
- [ ] `apps/media-worker`
- [ ] `packages/entitlements`
- [ ] `packages/source-adapters`
- [ ] `security`
- [ ] `infra` / `.github`
- [ ] `docs`

## Verification & Testing
List the exact commands you ran locally and their outcomes:
- [ ] TypeCheck passed (`apps/web`, `apps/media-worker`, `packages/entitlements`, `packages/source-adapters`)
- [ ] Unit, security & concurrency tests passed
- [ ] Media worker & integration tests passed
- [ ] Production build / static export verified (`apps/web`)

```text
Paste relevant local test/build command outputs here
```

## Security & Hygiene Checklist
- [ ] No real secrets, API keys, tokens, `.env` files, or PII committed
- [ ] All user-supplied URLs/paths adhere to SSRF and FFmpeg sanitization guards
- [ ] New environment variables (if any) are documented in `.env.example` with safe placeholders
- [ ] Documentation updated where behavior, endpoints, or configuration changed

## Screenshots / Artifacts (if UI change)
Attach before/after screenshots or screen recordings if applicable.
