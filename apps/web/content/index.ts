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
  formats: {
    slug: 'formats',
    title: 'Understanding Media Formats: Containers vs. Codecs',
    description: 'A comprehensive engineering guide on the fundamental differences between multimedia containers (MP4, WebM, MKV) and video/audio codecs (H.264, VP9, AV1, AAC, Opus), covering atom structures, faststart streaming, and lossless stream copying.',
    category: 'Media Architecture',
    readingTime: '8 min read',
    filePath: 'apps/web/content/docs/formats.md',
    lastUpdated: '2026-11-18',
  },
  resolutions: {
    slug: 'resolutions',
    title: 'Resolution & Bitrate Realities: 1080p, 4K, and 8K Engineering',
    description: 'A deep dive into modern adaptive video streaming architectures, disjoint DASH/HLS streams, bitrate vs resolution trade-offs, and 8K AV1 hardware requirements.',
    category: 'Media Architecture',
    readingTime: '10 min read',
    filePath: 'apps/web/content/docs/resolutions.md',
    lastUpdated: '2026-11-18',
  },
  'audio-quality': {
    slug: 'audio-quality',
    title: 'Audio Quality Engineering: Lossy vs. Lossless Mythbusting',
    description: 'A definitive psychoacoustic analysis of AAC, Opus, MP3, and FLAC audio codecs. An engineering debunking of lossy upsampling, 320kbps MP3 superiority, and fake FLAC conversion myths.',
    category: 'Audio Engineering',
    readingTime: '9 min read',
    filePath: 'apps/web/content/docs/audio-quality.md',
    lastUpdated: '2026-11-18',
  },
  troubleshooting: {
    slug: 'troubleshooting',
    title: 'Media Processing Diagnostics & Troubleshooting Guide',
    description: 'Resolve common digital media engineering issues including audio/video sync drift, PTS/DTS misalignment, variable frame rates, corrupted moov atoms, and network rate limits.',
    category: 'Diagnostics & Operations',
    readingTime: '9 min read',
    filePath: 'apps/web/content/docs/troubleshooting.md',
    lastUpdated: '2026-11-18',
  },
  faq: {
    slug: 'faq',
    title: 'Frequently Asked Questions (FAQ) & Platform Policy',
    description: 'Everything you need to know about MUXARO’s rolling 24-hour allowances, copyright and ethical policy, processing speeds, and zero-retention ephemeral privacy guarantees.',
    category: 'Platform & Support',
    readingTime: '7 min read',
    filePath: 'apps/web/content/docs/faq.md',
    lastUpdated: '2026-11-18',
  },
  security: {
    slug: 'security',
    title: 'Enterprise Security, Privacy Compliance & Verifiable Trust Architecture',
    description: 'Independent technical audit, GDPR & CCPA zero-retention verification, verified developer provenance, and defense-in-depth security engineering controls across MUXARO.',
    category: 'Trust & Security',
    readingTime: '8 min read',
    filePath: 'apps/web/content/docs/security.md',
    lastUpdated: '2026-11-19',
  },
};

export const LEGAL_REGISTRY: Record<string, LegalItem> = {
  terms: {
    slug: 'terms',
    title: 'Terms of Service',
    description: 'Legal terms of service governing the use of MUXARO media processing utilities, acceptable use policies, copyright representations, and rolling quota allowances.',
    filePath: 'apps/web/content/legal/terms.md',
    lastUpdated: '2026-11-18',
  },
  privacy: {
    slug: 'privacy',
    title: 'Privacy Policy',
    description: 'Comprehensive Privacy Policy outlining MUXARO’s privacy-by-design architecture, zero tracking cookies, GDPR and CCPA compliance, and ephemeral media file deletion guarantees.',
    filePath: 'apps/web/content/legal/privacy.md',
    lastUpdated: '2026-11-18',
  },
  dmca: {
    slug: 'dmca',
    title: 'Copyright Policy & DMCA Takedown Procedure',
    description: 'Formal Digital Millennium Copyright Act (17 U.S.C. § 512) notice requirements, designated copyright agent details, counter-notification procedure, and repeat infringer policy.',
    filePath: 'apps/web/content/legal/dmca.md',
    lastUpdated: '2026-11-18',
  },
};

export const ALL_DOCS = Object.values(DOCS_REGISTRY);
export const ALL_LEGAL = Object.values(LEGAL_REGISTRY);
