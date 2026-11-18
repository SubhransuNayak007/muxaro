# Getting Support for MUXARO

Need help setting up, developing, or deploying **MUXARO**? Use the resources below to find answers quickly and route requests to the right place.

---

## 1. Documentation First

Most setup, configuration, and runtime questions are answered in the repository documentation:

- **Local Development & Common Errors:** [`docs/deployment/LOCAL_SETUP.md`](./docs/deployment/LOCAL_SETUP.md)
- **Troubleshooting Guide:** [`docs/deployment/TROUBLESHOOTING.md`](./docs/deployment/TROUBLESHOOTING.md)
- **Production Deployment & Cloud Guides:** [`docs/deployment/PRODUCTION_DEPLOYMENT.md`](./docs/deployment/PRODUCTION_DEPLOYMENT.md)
- **Frontend & Design System:** [`docs/frontend/FRONTEND_ARCHITECTURE.md`](./docs/frontend/FRONTEND_ARCHITECTURE.md)
- **Security Controls & Threat Model:** [`docs/security/THREAT_MODEL.md`](./docs/security/THREAT_MODEL.md)
- **API Reference & Error Codes:** [`docs/api/API_REFERENCE.md`](./docs/api/API_REFERENCE.md)

---

## 2. Where to Ask Questions or Report Bugs

- **Bug Reports & Feature Requests:** Open an issue on [`https://github.com/SubhransuNayak007/muxaro/issues`](https://github.com/SubhransuNayak007/muxaro/issues) using the appropriate issue template.
- **General Questions & Architecture Discussions:** Use GitHub Discussions (if enabled) or label a GitHub Issue as `question`.
- **Security Vulnerabilities:** **Never** open a public issue. Report privately via [GitHub Private Vulnerability Reporting](https://github.com/SubhransuNayak007/muxaro/security/advisories/new) as outlined in [`SECURITY.md`](./SECURITY.md).

---

## 3. Helpful Information to Include in Support Requests

When opening an issue, please include:
1. Your operating system and runtime versions (`node -v`, `npm -v`, `ffmpeg -version`).
2. Whether you are running locally (`npm run dev`), via Docker Compose (`infra/docker-compose.yml`), or exporting static pages (`CLOUDFLARE_PAGES=1`).
3. The exact command executed, HTTP status code / error code (and `requestId` if applicable), and sanitized logs (**never paste secrets, cookies, `.env` values, or private URLs**).
4. Steps to reproduce the issue consistently.
