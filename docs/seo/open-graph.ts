/**
 * MUXARO — Central OpenGraph and SEO Metadata Configuration
 * Adheres to Next.js App Router Metadata specification.
 */

export interface RouteMetadata {
  title: string;
  description: string;
  path: string;
  keywords: string[];
  type?: 'website' | 'article';
}

export const SITE_CONFIG = {
  name: 'Muxaro',
  legalName: 'MUXARO Technologies',
  domain: 'muxaro.com',
  baseUrl: 'https://muxaro.com',
  defaultOgImage: 'https://muxaro.com/og/default-share.png',
  twitterHandle: '@muxaro',
  themeColor: '#F7F8FC',
};

export const ROUTE_METADATA: Record<string, RouteMetadata> = {
  home: {
    title: 'Muxaro — High-Integrity Cloud Media Processing Suite',
    description: 'Inspect, demux, remux, and convert audio and video streams online. Built with clean-room FFmpeg architecture, zero lossy upsampling claims, and honest rolling quotas.',
    path: '/',
    keywords: ['media converter', 'audio extractor', 'stream remuxing', 'video merger', 'ffmpeg online', 'dash muxing'],
    type: 'website',
  },
  tools: {
    title: 'Media Engineering Tools Hub | Muxaro',
    description: 'Access zero-loss audio extractors, DASH stream multiplexers, batch processors, and video container converters in your browser.',
    path: '/tools',
    keywords: ['media tools', 'browser audio extractor', 'video audio merger', 'lossless container remux'],
    type: 'website',
  },
  audioExtractor: {
    title: 'Lossless Audio Extractor — Direct Bitstream Demuxing | Muxaro',
    description: 'Extract native AAC, Opus, and MP3 audio tracks directly from video containers with zero generational loss. No fake upsampling, pure bitstream extraction.',
    path: '/tools/audio-extractor',
    keywords: ['extract audio from video', 'lossless audio extraction', 'stream copy aac', 'rip opus webm', 'mp4 to m4a copy'],
    type: 'website',
  },
  audioVideoMerger: {
    title: 'Audio-Video Stream Merger — Zero-Loss Remuxing | Muxaro',
    description: 'Combine separate 1080p, 4K, and 8K DASH video and audio streams into single MP4 or MKV containers with millisecond timestamp synchronization.',
    path: '/tools/audio-video-merger',
    keywords: ['merge video and audio', 'combine dash streams', 'video audio muxing', 'pts sync video', 'remux mp4 online'],
    type: 'website',
  },
  mediaConverter: {
    title: 'Universal Media Format Converter | Muxaro',
    description: 'Convert between MP4, WebM, MKV, MP3, AAC, and FLAC containers and codecs with granular control over bitrates, sample rates, and stream copying.',
    path: '/tools/media-converter',
    keywords: ['media converter', 'mp4 to webm', 'webm to mp4', 'flac converter', 'h264 to vp9'],
    type: 'website',
  },
  batchProcessing: {
    title: 'Batch Media Processing Engine | Muxaro',
    description: 'Process and convert multiple video and audio streams simultaneously with queue-based worker orchestration.',
    path: '/tools/batch-processing',
    keywords: ['batch media converter', 'bulk audio extraction', 'batch video remuxing'],
    type: 'website',
  },
  docs: {
    title: 'Media Engineering Documentation & Standards | Muxaro',
    description: 'Authoritative engineering guides on media containers, audio psychoacoustics, DASH streaming architecture, and stream troubleshooting.',
    path: '/docs',
    keywords: ['media engineering docs', 'video streaming guide', 'audio codecs comparison', 'ffmpeg troubleshooting'],
    type: 'article',
  },
  formatsDoc: {
    title: 'Containers vs Codecs: MP4, WebM, MKV & Bitstream Demuxing | Muxaro Docs',
    description: 'Deep technical guide explaining the difference between multimedia containers (ISOBMFF, Matroska) and video/audio codecs (H.264, VP9, AV1, Opus, AAC).',
    path: '/docs/formats',
    keywords: ['container vs codec', 'mp4 vs webm', 'isobmff atom', 'moov faststart', 'stream copy -c copy'],
    type: 'article',
  },
  resolutionsDoc: {
    title: '1080p, 4K & 8K Streaming Realities: Bitrate vs Resolution | Muxaro Docs',
    description: 'Understanding separate DASH streams, high-resolution bitrate starvation, VP9/AV1 decoding overhead, and stream multiplexing realities.',
    path: '/docs/resolutions',
    keywords: ['4k vs 1080p bitrate', 'youtube dash streams', '8k av1 decoding', 'adaptive bitrate streaming'],
    type: 'article',
  },
  audioQualityDoc: {
    title: 'Audio Quality Engineering: Lossy vs Lossless Mythbusting | Muxaro Docs',
    description: 'Objective psychoacoustic analysis of AAC, Opus, MP3, and FLAC. Why upsampling lossy streams to 320kbps or FLAC produces pure file bloat.',
    path: '/docs/audio-quality',
    keywords: ['lossy vs lossless myths', 'opus vs aac', 'mp3 320kbps myth', 'audio masking threshold', 'audio stream copy'],
    type: 'article',
  },
  troubleshootingDoc: {
    title: 'Media Processing Diagnostics & Troubleshooting Guide | Muxaro Docs',
    description: 'Resolve A/V desync, PTS timestamp drift, corrupted moov atoms, unsupported container errors, and 429 rate limit backoff.',
    path: '/docs/troubleshooting',
    keywords: ['audio video out of sync fix', 'pts dts drift', 'corrupt moov atom', '429 rate limit media', 'ffmpeg errors'],
    type: 'article',
  },
  faqDoc: {
    title: 'Frequently Asked Questions & Platform Policy | Muxaro Docs',
    description: 'Details on rolling 24-hour quota math, ephemeral storage security, copyright compliance, and processing engine speeds.',
    path: '/docs/faq',
    keywords: ['Muxaro faq', 'rolling quota reset', 'media processing speeds', 'ephemeral storage security'],
    type: 'article',
  },
  terms: {
    title: 'Terms of Service | Muxaro',
    description: 'Permitted use, user representations, rolling quota limits, copyright compliance, and limitation of liability.',
    path: '/legal/terms',
    keywords: ['terms of service', 'user agreement', 'media processing terms'],
    type: 'article',
  },
  privacy: {
    title: 'Privacy Policy & Ephemeral Storage Guarantees | Muxaro',
    description: 'GDPR and CCPA compliant privacy policy. Zero tracking cookies, zero model training on user files, immediate scratch file destruction.',
    path: '/legal/privacy',
    keywords: ['privacy policy', 'gdpr compliance', 'ephemeral file retention', 'no cookie tracking'],
    type: 'article',
  },
  dmca: {
    title: 'Copyright Policy & DMCA Takedown Procedure | Muxaro',
    description: 'Formal DMCA Section 512 notice guidelines, designated agent contact, counter-notification procedure, and repeat infringer policy.',
    path: '/legal/dmca',
    keywords: ['dmca policy', 'copyright takedown', 'intellectual property notice', 'counter notification'],
    type: 'article',
  },
};

/**
 * Helper to build standard Next.js Metadata object
 */
export function buildMetadata(key: keyof typeof ROUTE_METADATA) {
  const meta = ROUTE_METADATA[key];
  if (!meta) throw new Error(`Unknown metadata key: ${String(key)}`);

  const fullUrl = `${SITE_CONFIG.baseUrl}${meta.path}`;
  const ogImageUrl = `${SITE_CONFIG.baseUrl}/og${meta.path === '/' ? '/home' : meta.path}.png`;

  return {
    title: meta.title,
    description: meta.description,
    keywords: meta.keywords.join(', '),
    alternates: {
      canonical: fullUrl,
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: fullUrl,
      siteName: SITE_CONFIG.name,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: meta.title,
        },
      ],
      type: meta.type || 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
      site: SITE_CONFIG.twitterHandle,
      creator: SITE_CONFIG.twitterHandle,
      images: [ogImageUrl],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  };
}
