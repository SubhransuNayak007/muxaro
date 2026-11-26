---
title: "Privacy Policy"
slug: "privacy"
description: "Comprehensive Privacy Policy outlining MUXARO's privacy-by-design architecture, zero tracking cookies, GDPR and CCPA compliance, and ephemeral media file deletion guarantees."
author: "MUXARO Data Protection & Privacy Team"
publishedAt: "2026-11-18"
updatedAt: "2026-11-26"
category: "Legal & Compliance"
keywords: ["privacy policy", "gdpr compliance", "ccpa cpra", "ephemeral storage guarantee", "zero tracking cookies", "data minimization"]
---

# Privacy Policy

**Effective Date:** November 18, 2026  
**Last Updated:** November 26, 2026  

MUXARO Technologies (**"Muxaro"**, **"we"**, **"us"**, or **"our"**) operates on an uncompromising foundational principle: **Privacy by Design and Radical Data Minimization**. 

We believe that high-utility developer tools and media converters do not need to track users across the web, profile reading habits, or build marketing dossiers. This Privacy Policy explains exactly what data we process, why we process it, how our ephemeral file destruction guarantees work, and your statutory rights under the European Union General Data Protection Regulation (**GDPR**), the California Consumer Privacy Act as amended by the California Privacy Rights Act (**CCPA/CPRA**), and applicable international privacy frameworks.

---

## 1. Core Privacy Commitments

1. **Zero Tracking Cookies:** We do not use third-party advertising cookies, retargeting pixels, or behavioral tracking beacons.
2. **100% Browser-Local PDF & Tier-1 Media Processing:** All 38 PDF tools and Tier-1 video/audio tools run inside your browser tab via WebAssembly. Your PDFs and local documents never leave your device (`0 bytes uploaded`), and optional recent history is stored strictly in your own browser's IndexedDB.
3. **Zero Persistent Server Storage:** When using Cloud FFmpeg workers, uploaded source streams and converted outputs exist solely on ephemeral scratch volumes and are destroyed within 60 minutes of completion.
4. **Zero AI Training on User Media:** We **never** inspect, transcribe, fingerprint, or train machine learning models on your files.
5. **Zero Data Monetization:** We never sell, rent, lease, or share user data or files with data brokers, advertisers, or third parties.

---

## 2. Information We Process

Because we practice strict data minimization, the only data we process falls into two categories:

### 2.1 Technical Telemetry & Operational Logs
When you interact with the Service, our edge servers automatically record minimal operational logs required to maintain network stability, prevent denial-of-service attacks, and enforce our rolling 24-hour fair use quotas:
- **Hashed IP Address:** Your Internet Protocol (IP) address is immediately pseudonymized using a cryptographic one-way salt/hash (SHA-256) at the application gateway. We do not store plain-text IP addresses in long-term application databases.
- **Request Timestamps:** Exact millisecond timestamps to calculate dynamic 24-hour quota recovery.
- **User-Agent String:** Browser engine and operating system family, solely to ensure delivery of compatible container and codec combinations (e.g. serving MP4 to Safari and WebM to Chrome).
- **HTTP Routing Metrics:** Request path, HTTP status code, and latency measurements for real-time error rate monitoring.

### 2.2 Processing Job Metadata
To execute and track your media jobs, our queue engine logs:
- Job identifiers (`jobId`), job status (`QUEUED`, `PROCESSING`, `READY`, `FAILED`), and job type (`audio_extraction`, `stream_merge`, `format_conversion`).
- Audio/video format descriptors (e.g. container: `mp4`, video codec: `h264`, audio codec: `aac`, target resolution: `1080p`).
- File size (bytes) and duration (seconds), used strictly for scratch disk resource allocation.

---

## 3. Ephemeral Scratch Storage & Automated Erasure

The operational lifecycle of every media file processed on MUXARO follows a rigid, automated quarantine and destruction pipeline:

```
[ User Initiates Job ]
         │
         ▼
[ Isolated Scratch Volume ] ──► Media chunks processed in sandboxed RAM / NVMe
         │
         ▼
[ Encrypted Temporary Bucket ] ──► Output file stored with signed single-use token
         │
         ▼
[ Automated Trigger: Download or 60-Minute Expiry ]
         │
         ▼
[ Cryptographic Shredding ] ──► Byte blocks unlinked and permanently overwritten from disk
```

1. **Sandboxed Processing:** Media files are processed inside isolated worker environments with bounded memory, CPU, and disk quotas. Workers run as unprivileged users without administrative host privileges.
2. **Time-To-Live (TTL):** The maximum lifetime of any processed media artifact in temporary object storage is **60 minutes**.
3. **Irreversible Destruction:** Once downloaded or once the 60-minute window elapses, an automated garbage collection daemon executes an immediate unlinking and cryptographic wipe of the object storage blocks. We maintain no backups, cold storage replicas, or archives of user media.

---

## 4. Legal Bases for Processing (GDPR Article 6)

For individuals located in the European Economic Area (EEA), United Kingdom, or Switzerland, we process information under the following legal bases:
1. **Contractual Performance (Art. 6(1)(b) GDPR):** Processing requested media files, demuxing bitstreams, and delivering the resulting output is strictly necessary to perform our contractual service requested by you.
2. **Legitimate Interests (Art. 6(1)(f) GDPR):** Maintaining hashed IP logs and rate-limiting counters is necessary for our legitimate interests in protecting infrastructure integrity, preventing abusive automated scraping, and securing the platform against cyberattacks.
3. **Legal Compliance (Art. 6(1)(c) GDPR):** Responding to verified, statutory law enforcement orders or formal DMCA copyright notices.

---

## 5. Third-Party Infrastructure Providers

We rely on carefully audited infrastructure partners who meet rigorous security and privacy standards (SOC 2 Type II, ISO 27001, and standard contractual clauses for cross-border data protection):

| Provider Category | Function | Data Exposed | Privacy Safeguards |
| :--- | :--- | :--- | :--- |
| **Edge CDN & DDoS Protection** | Cloudflare / Fastly | Anonymized network telemetry, encrypted transit | Zero tracking, strict transit-only caching |
| **Cloud Compute & Object Storage** | AWS / Hetzner / MinIO | Encrypted ephemeral scratch volumes | Automated 60-minute shredding, isolated VPC |

---

## 6. Your Statutory Rights (GDPR & CCPA/CPRA)

Depending on your geographical jurisdiction, you enjoy specific statutory rights regarding your personal information:

### 6.1 European Union & UK Residents (GDPR / UK DPA)
- **Right of Access (Art. 15):** Request confirmation of whether we hold personal data relating to you.
- **Right to Erasure / "Right to be Forgotten" (Art. 17):** Request the immediate deletion of any associated log records.
- **Right to Restriction of Processing (Art. 18):** Restrict our processing of your telemetry under specific conditions.
- **Right to Data Portability (Art. 20):** Receive your personal data in a structured, machine-readable format.
- **Right to Lodge a Complaint:** You have the right to lodge a complaint with your local Data Protection Authority (DPA) in your EU member state of residence.

### 6.2 California Residents (CCPA / CPRA)
- **Right to Know:** You may request details on the categories and specific pieces of personal information collected.
- **Right to Delete:** Request deletion of personal information subject to legal exceptions.
- **Right to Opt-Out of Sale or Sharing:** We do not sell or share personal information as defined by the CCPA/CPRA.
- **Right to Non-Discrimination:** We will never deny service, charge different prices, or provide a lower quality of service because you exercised any of your privacy rights.

To exercise any of these rights, email our Data Protection Officer at `privacy@muxaro.app`. Because we maintain pseudonymized, hashed logs and no persistent accounts, we may require verification of your request parameters to locate relevant records.

---

## 7. Data Retention Schedule

| Data Category | Purpose | Retention Period | Destruction Mechanism |
| :--- | :--- | :--- | :--- |
| **User Media Files** | Video/audio processing | **Max 60 minutes** | Automated unlinking & cryptographic shred |
| **Hashed IP & Rate-Limit Logs**| Abuse & DDoS prevention | **24 hours rolling** | Automatic log eviction |
| **Edge Server Logs** | DDoS mitigation & security | **7 days** | Automated rotating log purge |
| **Legal & DMCA Records** | Statutory compliance | **3 years** | Encrypted administrative archive |

---

## 8. Children's Privacy (COPPA Compliance)

The Service is strictly directed toward general audiences, professional media engineers, and adults. We do not knowingly collect, solicit, or maintain personal information from children under the age of 13 (or under 16 in certain European jurisdictions), in compliance with the United States Children's Online Privacy Protection Act (COPPA). If we discover that an individual under 13 has submitted information, we will immediately delete that information.

---

## 9. Security Architecture

We enforce defense-in-depth engineering standards to safeguard all data in transit and at rest:
- **Transit Encryption:** All connections enforce TLS 1.3 with modern forward-secret cipher suites.
- **Isolated Sandboxing:** Containerized execution prevents cross-tenant process visibility.
- **Least Privilege Access:** Media workers run with stripped Linux capabilities, non-root user IDs, and read-only root filesystems with ephemeral memory mounts.

---

## 10. Modifications & Contact

We may periodically update this Privacy Policy to reflect evolving regulatory frameworks or architectural improvements. Updates take effect immediately upon publication.

If you have questions, comments, or requests regarding this Privacy Policy, please contact:
- **Data Protection Officer:** `privacy@muxaro.app`
- **Mailing Address:** MUXARO Technologies, Attention: Privacy & Compliance Officer.
