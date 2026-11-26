---
title: "PDF Studio Guide: 38 Browser-Local, Zero-Upload Workflows"
slug: "pdf-studio"
description: "Architecture and usage guide for all 38 browser-local PDF utilities powered by QPDF WASM, pdf-lib, PDF.js, Tesseract.js OCR, and WebCrypto."
author: "MUXARO Document Engineering Team"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
category: "Suite Guides"
keywords: ["pdf studio", "browser local pdf", "qpdf wasm", "pdf ocr searchable", "pkcs7 signature verify", "zero upload pdf"]
---

# PDF Studio Guide: 38 Browser-Local, Zero-Upload Workflows

Every single tool inside **[PDF Studio](/tools/pdf)** executes **100% locally inside your browser tab**. Not a single byte of your PDF, Word, PowerPoint, or image document is ever transmitted to a remote server.

---

## 1. Self-Hosted WASM & Client Security Architecture

All processing engines are self-hosted directly under `/vendor/` with strict Cross-Origin Isolation (`COOP` / `COEP`) and `object-src 'none'` CSP policies:
- **`pdfjs-dist` (High-DPI Canvas Renderer):** Renders every page preview onto `<canvas>` elements rather than `<object>` or `<iframe>` plugins, preventing PDF JavaScript execution in the host browser.
- **`qpdf-run` WASM:** Powers lossless structural stream compression (`--object-streams=generate --recompress-flate`), xref table repair, and standards-compliant **AES-256 / AES-128** encryption and decryption.
- **`pdf-lib` + `@pdf-lib/fontkit`:** Performs in-place content-stream editing, AcroForm interactive field generation, custom font subsetting (`Inter`, `Plus Jakarta Sans`, `JetBrains Mono`, `Merriweather`), and watermark/annotation manipulation.
- **`tesseract.js` Multi-Worker Pool:** Runs concurrent local LSTM OCR to output plain `.txt`, `.md`, `.csv`, `.html`, `.rtf`, or **Searchable PDFs** with invisible `Tr=3` text layers.
- **WebCrypto PKCS#7 / CMS Verifier:** Parses ASN.1 X.509 certificates and verifies `/ByteRange` SHA digests natively in the browser.

> [!NOTE]
> Processed outputs are cached locally in your browser's **IndexedDB Workspace** (`Local PDF History`) so you can inspect recent exports at [`/tools/pdf/recent`](/tools/pdf/recent) or chain any output directly into another PDF tool with zero re-uploading.

---

## 2. All 38 PDF Tools by Category

### Create (3)
- **[Invoice Maker](/tools/pdf/invoice)**, **[Receipt Maker](/tools/pdf/receipt)**, and **[Quote & Estimate Maker](/tools/pdf/quote):** Generate clean A4 PDF documents with saved sender profiles, itemized tax/discount math, and 1-click Quote-to-Invoice conversion.

### Edit & Organize (14)
- **[Read & Inspect PDF](/tools/pdf/view):** High-DPI canvas viewer with text search, zoom, thumbnail rail, and instant tool handoff.
- **[Edit PDF](/tools/pdf/edit):** Invisible content-stream text replacement, dynamic font matching, Find & Replace, highlights, shapes, `/Link` editing, and whiteout/redactions.
- **[Make PDF Fillable](/tools/pdf/make-fillable):** Auto-detect blank lines and labels or place Text, Checkbox, Radio, and Dropdown AcroForm fields.
- **[Sign PDF](/tools/pdf/sign):** Draw smooth vector strokes, type calligraphic signatures, or stamp transparent images.
- **Page Structure:** **[Merge](/tools/pdf/merge)** (with natural filename sorting and 2-file duplex interleave), **[Split](/tools/pdf/split)** (by pages, bookmark outlines, or $O(\log N)$ binary-search max MB), **[Delete Pages](/tools/pdf/delete-pages)**, **[Reorder](/tools/pdf/reorder)**, **[Rotate](/tools/pdf/rotate)** (with Auto-Rotate Upright), **[Extract](/tools/pdf/extract)**, **[Crop](/tools/pdf/crop)**, **[Watermark](/tools/pdf/watermark)** (including Behind-Content and QR vectors), **[Page Numbers](/tools/pdf/page-numbers)** (Roman, Facing, Cover skip), and **[Header & Footer](/tools/pdf/header-footer)** (including Bates numbering).

### Optimize & Inspect (6)
- **[Compress PDF](/tools/pdf/compress):** 3-tier engine combining lossless QPDF object-stream compression, SMask-aware selectable-text optimization, and adaptive rasterization (with automatic revert if compressed size exceeds original).
- **[Repair PDF](/tools/pdf/repair):** 3-stage recovery (`qpdf` xref repair → `pdf-lib` rebuild → PDF.js visual reconstruction).
- **[Compare PDF](/tools/pdf/compare):** Synced side-by-side viewer, crimson pixel-diff overlay, and full-document word & formatting diff (supports PDF-vs-PDF and PDF-vs-DOCX).
- **[Flatten PDF](/tools/pdf/flatten)**, **[Remove Blank Pages](/tools/pdf/remove-blank-pages)**, and **[Batch PDF Processing](/tools/pdf/batch)** (13 parallel actions exported as one ZIP).

### Convert & OCR (8)
- **[Create / Scan PDF](/tools/pdf/make-pdf):** Camera capture or mobile QR handoff with 8-DOF homography perspective dewarping and Bradley adaptive B&W scan filters.
- **[Image to PDF](/tools/pdf/image-to-pdf)** & **[PDF to Image](/tools/pdf/pdf-to-jpg):** EXIF auto-rotation and 72 / 150 / 300 DPI or stitched export.
- **[PDF to Word](/tools/pdf/pdf-to-word)**, **[Word to PDF](/tools/pdf/word-to-pdf)**, and **[PowerPoint to PDF](/tools/pdf/powerpoint-to-pdf):** Structure-aware `.docx` and `.pptx` conversions with auto-OCR fallback.
- **[Extract Text & OCR](/tools/pdf/ocr)** & **[Extract Images](/tools/pdf/extract-images):** Searchable `Tr=3` PDF export and lossless raw `/DCTDecode` JPEG / font stream extraction.

### Protect & Sanitize (7)
- **[Verify PDF Signatures](/tools/pdf/verify-signatures)**, **[Protect PDF](/tools/pdf/protect)** (AES-256), **[Unlock PDF](/tools/pdf/unlock)** (including Read-Only AcroForm unlock), **[Document Info & Metadata](/tools/pdf/metadata)**, **[Remove Hidden Info](/tools/pdf/remove-metadata)**, **[Remove Comments](/tools/pdf/remove-annotations)**, and **[Clean Up & Sanitize PDF](/tools/pdf/sanitize)** (deep strip of `/JavaScript`, `/JS`, `/EmbeddedFiles`, `/OpenAction`, and optional pixel-burn redaction).

---

*Related guides: [Video Studio Guide](/docs/video-studio) · [Trust & Security](/docs/security) · [FAQ](/docs/faq)*
