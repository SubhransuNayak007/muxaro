# Getting Support for MUXARO

Need help setting up, developing, or deploying **MUXARO**? Use the resources below to find answers quickly.

---

## 1. Documentation First

- **Project Overview & Quick Start:** [`README.md`](./README.md)
- **System Architecture Blueprint:** [`docs/architecture.md`](./docs/architecture.md)
- **Frontend Architecture & Design System:** [`docs/frontend/FRONTEND_ARCHITECTURE.md`](./docs/frontend/FRONTEND_ARCHITECTURE.md) and [`docs/design/MUXARO_DESIGN_SYSTEM.md`](./docs/design/MUXARO_DESIGN_SYSTEM.md)
- **Security Policy & Protections:** [`SECURITY.md`](./SECURITY.md)

---

## 2. Where to Ask Questions or Report Bugs

- **Live Deployment:** [`https://muxaro.vercel.app`](https://muxaro.vercel.app) (and [`https://muxaro.app`](https://muxaro.app))
- **Bug Reports & Feature Requests:** Open an issue on [`https://github.com/SubhransuNayak007/muxaro/issues`](https://github.com/SubhransuNayak007/muxaro/issues) using our structured templates.
- **Security Vulnerabilities:** **Never** open a public issue. Report privately via [GitHub Private Vulnerability Reporting](https://github.com/SubhransuNayak007/muxaro/security/advisories/new) per [`SECURITY.md`](./SECURITY.md).

---

## 3. Helpful Information to Include in Support Requests

When opening an issue, please include:
1. Your operating system, browser + version (e.g., Chrome/Edge/Firefox/Safari), and Node.js version (`node -v`).
2. Whether you are running locally (`npm --prefix apps/web run dev`), testing a production build (`npm --prefix apps/web run build`), or using the live Vercel deployment (`https://muxaro.vercel.app`).
3. Whether `Eco-Mode`, COOP/COEP (`SharedArrayBuffer`), or OPFS support is active in your browser session.
4. Steps to reproduce cleanly without pasting `.env` values, secrets, or personal data.
