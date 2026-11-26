/**
 * MUXARO — Web Content Registry & Document Index
 * Provides typed access to markdown documentation and legal policies.
 */

export interface DocItem {
  slug: string;
  title: string;
  description: string;
  category: string;
  readingTime: string;
  filePath: string;
  lastUpdated: string;
}

export interface LegalItem {
  slug: string;
  title: string;
  description: string;
  filePath: string;
  lastUpdated: string;
}

export const DOCS_REGISTRY: Record<string, DocItem> = {
  'video-studio': {
    slug: 'video-studio',
    title: 'Video Studio Guide: 14 Hybrid FFmpeg Tools & Tool Chaining',
    description:
      'Complete engineering guide to all 14 Video Studio tools: 2-pass 10 MB/16 MB target compression, Tier-1 browser lossless trimming, 9:16 smart padding, subtitle shifting, and zero-reupload chaining.',
    category: 'Suite Guides',
    readingTime: '7 min read',
    filePath: 'apps/web/content/docs/video-studio.md',
    lastUpdated: '2026-11-26',
  },
  'pdf-studio': {
    slug: 'pdf-studio',
    title: 'PDF Studio Guide: 38 Browser-Local, Zero-Upload Workflows',
    description:
      'Architecture and workflows for all 38 browser-local PDF utilities powered by QPDF WASM, pdf-lib, PDF.js, Tesseract OCR, and WebCrypto PKCS#7 verification.',
    category: 'Suite Guides',
    readingTime: '8 min read',
    filePath: 'apps/web/content/docs/pdf-studio.md',
    lastUpdated: '2026-11-26',
  },
  'audio-studio': {
    slug: 'audio-studio',
    title: 'Audio Studio Architecture & Upcoming Suite Roadmap',
    description:
      'Explore MUXARO’s active audio workflows (lossless stem extraction, EBU R128 loudness normalization, A/V sync) and the upcoming Audio Studio suite modules.',
    category: 'Audio Engineering',
    readingTime: '6 min read',
    filePath: 'apps/web/content/docs/audio-studio.md',
    lastUpdated: '2026-11-26',
  },
  formats: {
    slug: 'formats',
    title: 'Understanding Media Formats: Containers vs. Codecs',
    description:
      'A comprehensive engineering guide on multimedia containers (MP4, WebM, MKV) and video/audio codecs (H.264, VP9, AV1, AAC, Opus), covering faststart streaming and lossless stream copying.',
    category: 'Media Architecture',
    readingTime: '8 min read',
    filePath: 'apps/web/content/docs/formats.md',
    lastUpdated: '2026-11-26',
  },
  resolutions: {
    slug: 'resolutions',
    title: 'Resolution & Bitrate Realities: 1080p, 4K, and 8K Engineering',
    description:
      'Deep dive into adaptive video streaming architectures, disjoint DASH/HLS streams, bitrate vs. resolution trade-offs, and 8K AV1 hardware requirements.',
    category: 'Media Architecture',
    readingTime: '10 min read',
    filePath: 'apps/web/content/docs/resolutions.md',
    lastUpdated: '2026-11-26',
  },
  'audio-quality': {
    slug: 'audio-quality',
    title: 'Audio Quality Engineering: Lossy vs. Lossless Mythbusting',
    description:
      'A definitive psychoacoustic analysis of AAC, Opus, MP3, and FLAC codecs debunking lossy upsampling and fake 320 kbps or FLAC conversions.',
    category: 'Audio Engineering',
    readingTime: '9 min read',
    filePath: 'apps/web/content/docs/audio-quality.md',
    lastUpdated: '2026-11-26',
  },
  troubleshooting: {
    slug: 'troubleshooting',
    title: 'Diagnostics & Troubleshooting Guide',
    description:
      'Resolve audio/video sync drift, PTS/DTS misalignment, corrupted moov atoms, large browser WASM PDF memory limits, and custom worker setup.',
    category: 'Diagnostics & Operations',
    readingTime: '9 min read',
    filePath: 'apps/web/content/docs/troubleshooting.md',
    lastUpdated: '2026-11-26',
  },
  faq: {
    slug: 'faq',
    title: 'Frequently Asked Questions (FAQ) & Platform Architecture',
    description:
      'Clear answers on zero-credit open access, 38 browser-local PDF tools, 14 hybrid Video Studio tools, upcoming Audio Studio modules, and 60-minute ephemeral worker cleanup.',
    category: 'Platform & Support',
    readingTime: '6 min read',
    filePath: 'apps/web/content/docs/faq.md',
    lastUpdated: '2026-11-26',
  },
  security: {
    slug: 'security',
    title: 'Security, Browser-Local Privacy & Zero-Retention Architecture',
    description:
      'Technical audit of MUXARO’s zero-upload client execution, GDPR & CCPA compliance, 60-minute ephemeral worker purging, and defense-in-depth controls.',
    category: 'Trust & Security',
    readingTime: '8 min read',
    filePath: 'apps/web/content/docs/security.md',
    lastUpdated: '2026-11-26',
  },
};

export const LEGAL_REGISTRY: Record<string, LegalItem> = {
  terms: {
    slug: 'terms',
    title: 'Terms of Service',
    description:
      'Legal terms of service governing the use of MUXARO’s browser-local PDF utilities, media processing tools, and acceptable use policies.',
    filePath: 'apps/web/content/legal/terms.md',
    lastUpdated: '2026-11-26',
  },
  privacy: {
    slug: 'privacy',
    title: 'Privacy Policy',
    description:
      'Comprehensive Privacy Policy outlining browser-local zero-upload processing, zero tracking cookies, GDPR/CCPA compliance, and 60-minute ephemeral deletion.',
    filePath: 'apps/web/content/legal/privacy.md',
    lastUpdated: '2026-11-26',
  },
  dmca: {
    slug: 'dmca',
    title: 'Copyright Policy & DMCA Takedown Procedure',
    description:
      'Formal Digital Millennium Copyright Act (17 U.S.C. § 512) notice requirements, designated copyright agent details, counter-notification procedure, and repeat infringer policy.',
    filePath: 'apps/web/content/legal/dmca.md',
    lastUpdated: '2026-11-26',
  },
};

export const ALL_DOCS = Object.values(DOCS_REGISTRY);
export const ALL_LEGAL = Object.values(LEGAL_REGISTRY);
