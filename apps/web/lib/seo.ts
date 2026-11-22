import type { Metadata } from 'next';

/**
 * MUXARO — Unified SEO & Structured Data (JSON-LD) Engine
 * Designed for Search Engine Optimization, Answer Engine Optimization (AEO),
 * and Schema.org rich snippets across all public routes.
 */

export function getSiteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL || 'https://muxaro.app';
  return url.trim().replace(/\/+$/, '');
}

export interface MetadataOptions {
  title: string;
  description: string;
  path?: string;
  noIndex?: boolean;
  ogType?: 'website' | 'article';
  ogImage?: string;
  publishedTime?: string;
  modifiedTime?: string;
  keywords?: string[];
}

export function constructMetadata({
  title,
  description,
  path = '',
  noIndex = false,
  ogType = 'website',
  ogImage = '/brand/og-image.png',
  publishedTime,
  modifiedTime,
  keywords,
}: MetadataOptions): Metadata {
  const siteUrl = getSiteUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const canonicalUrl = path === '/' ? `${siteUrl}/` : `${siteUrl}${normalizedPath}`;
  const imageUrl = ogImage.startsWith('http') ? ogImage : `${siteUrl}${ogImage}`;

  const meta: Metadata = {
    title,
    description,
    keywords: keywords || [
      'media converter',
      'video converter',
      'audio extractor',
      'merge video and audio',
      'lossless audio',
      '8k video processing',
      'muxaro workspace',
      'cloud media processing',
      'ffmpeg web tool',
    ],
    alternates: {
      canonical: normalizedPath,
    },
    openGraph: {
      type: ogType,
      url: canonicalUrl,
      siteName: 'MUXARO',
      title,
      description,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      ...(ogType === 'article' && publishedTime ? { publishedTime } : {}),
      ...(ogType === 'article' && modifiedTime ? { modifiedTime } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
  };

  if (noIndex) {
    meta.robots = {
      index: false,
      follow: false,
    };
  }

  return meta;
}

export function buildOrganizationSchema(siteUrl: string) {
  return {
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: 'MUXARO',
    legalName: 'MUXARO Creator Media Systems & Engineering Labs',
    url: siteUrl,
    logo: {
      '@type': 'ImageObject',
      url: `${siteUrl}/brand/muxaro-mark.svg`,
      width: '512',
      height: '512',
    },
    description:
      'Enterprise-grade creator media workspace and high-integrity cloud processing engine. Specializing in clean-room FFmpeg stream demuxing, lossless audio extraction, and zero-retention ephemeral privacy.',
    foundingDate: '2024',
    knowsAbout: [
      'Digital Audio Processing',
      'Video Container Multiplexing',
      'FFmpeg Architecture',
      'Lossless Bitstream Demuxing',
      'Psychoacoustic Codec Optimization',
      'Zero-Retention Cloud Architecture',
      'Ephemeral Storage Security',
      'GDPR & CCPA Media Compliance',
    ],
    publishingPrinciples: `${siteUrl}/docs/faq`,
    securityPolicy: `${siteUrl}/privacy`,
    termsOfService: `${siteUrl}/terms`,
  };
}

export function buildRootWebAppContextJsonLd(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      buildOrganizationSchema(siteUrl),
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: 'MUXARO',
        description: 'Universal Video Downloader & Lossless Media Workspace.',
        publisher: {
          '@id': `${siteUrl}/#organization`,
        },
      },
      {
        '@type': 'WebApplication',
        '@id': `${siteUrl}/#webapp`,
        name: 'MUXARO Media Workspace & Processing Engine',
        alternateName: 'MUXARO Video Downloader & Converter',
        url: `${siteUrl}/`,
        description:
          'Enterprise-grade creator media workspace for downloading 8K/4K videos, extracting lossless studio-grade audio, and converting containers with zero-retention 60-minute automatic file deletion.',
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'All modern web browsers (Chrome, Firefox, Safari, Edge)',
        browserRequirements: 'Requires JavaScript. HTML5 Media Source Extensions supported.',
        softwareVersion: '1.0.0',
        inLanguage: 'en-US',
        isAccessibleForFree: true,
        offers: {
          '@type': 'Offer',
          price: '0.00',
          priceCurrency: 'USD',
          description:
            'Free daily allowance with 10 single media processing jobs and 1 batch playlist job per rolling 24-hour window with zero ads and zero retention.',
        },
        featureList: [
          'High-speed video downloading up to 8K 60fps (YouTube, TikTok, Instagram, Twitter/X)',
          'Lossless bitstream audio extraction (AAC, Opus, MP3 320kbps, FLAC, WAV)',
          'High-fidelity container conversion (MP4, MKV, WebM, MOV)',
          'DASH/HLS disjoint video and audio stream merging with millisecond timestamp synchronization',
          'Multi-clip video concatenation with PTS/DTS alignment',
          'Batch processing and playlist archiving up to 50 items to ZIP',
          '4 GB free file processing with zero display or popup ads',
          'Strict 60-minute ephemeral zero-retention storage security',
        ],
        creator: {
          '@id': `${siteUrl}/#organization`,
        },
      },
      {
        '@type': 'HowTo',
        '@id': `${siteUrl}/#howto`,
        name: 'How to Download and Convert Videos Online Without Ads',
        description:
          'Step-by-step instructions for downloading online media streams or converting files using MUXARO with zero advertisements and full 4K preservation.',
        totalTime: 'PT1M',
        estimatedCost: {
          '@type': 'MonetaryAmount',
          currency: 'USD',
          value: '0',
        },
        step: [
          {
            '@type': 'HowToStep',
            url: `${siteUrl}/#step1`,
            name: 'Paste Link or Upload File',
            itemListElement: [
              {
                '@type': 'HowToDirection',
                text: 'Paste a video URL from YouTube, TikTok, Instagram, or Twitter into the Omnibox, or upload a local media file up to 4 GB.',
              },
            ],
          },
          {
            '@type': 'HowToStep',
            url: `${siteUrl}/#step2`,
            name: 'Select Output Preset',
            itemListElement: [
              {
                '@type': 'HowToDirection',
                text: 'Select your target format: Best Quality (up to 8K/4K with audio), 1080p MP4, 320 kbps MP3, or Lossless FLAC.',
              },
            ],
          },
          {
            '@type': 'HowToStep',
            url: `${siteUrl}/#step3`,
            name: 'Download Processed Media',
            itemListElement: [
              {
                '@type': 'HowToDirection',
                text: 'Click Process or Download. Your file is rendered with direct stream-copying and available immediately with a 60-minute automatic purge timer.',
              },
            ],
          },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${siteUrl}/#faq`,
        name: 'MUXARO Platform & Media Architecture FAQ',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'Is MUXARO really 100% ad-free?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. MUXARO has zero pop-up ads, zero banner ads, and zero redirect links. All operations run in a clean, private interface.',
            },
          },
          {
            '@type': 'Question',
            name: 'What is the maximum file size limit for free users?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'MUXARO allows processing of files up to 4,000 MB (4 GB) for free, which is 40x higher than typical online conversion tools.',
            },
          },
          {
            '@type': 'Question',
            name: 'How does MUXARO download 1080p and 4K YouTube videos with sound?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Modern platforms store 1080p and 4K video as separate DASH streams without embedded audio. MUXARO multiplexes the disjoint video and high-bitrate audio streams into a single playable MP4 container with millisecond timestamp synchronization.',
            },
          },
          {
            '@type': 'Question',
            name: 'How long are files kept on MUXARO servers?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'All files are held strictly on ephemeral scratch disks and permanently deleted after exactly 60 minutes. MUXARO maintains zero persistent storage of user content.',
            },
          },
        ],
      },
    ],
  };
}

export function buildToolSoftwareAppJsonLd({
  name,
  description,
  path,
  features,
}: {
  name: string;
  description: string;
  path: string;
  features: string[];
}) {
  const siteUrl = getSiteUrl();
  const fullUrl = `${siteUrl}${path}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${fullUrl}#software`,
    name,
    url: fullUrl,
    description,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'All modern web browsers',
    softwareVersion: '1.0.0',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0.00',
      priceCurrency: 'USD',
      description: 'Free tier includes rolling daily media processing jobs with zero retention.',
    },
    featureList: features,
    creator: {
      '@type': 'Organization',
      name: 'MUXARO Media Engineering Labs',
      url: siteUrl,
    },
  };
}

export function buildHowToJsonLd({
  name,
  description,
  path,
  totalTime = 'PT1M',
  steps,
}: {
  name: string;
  description: string;
  path: string;
  totalTime?: string;
  steps: Array<{ name: string; text: string }>;
}) {
  const siteUrl = getSiteUrl();
  const fullUrl = `${siteUrl}${path}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    '@id': `${fullUrl}#howto`,
    name,
    description,
    totalTime,
    estimatedCost: {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: '0',
    },
    tool: [
      {
        '@type': 'HowToTool',
        name: 'MUXARO Media Workspace',
      },
      {
        '@type': 'HowToTool',
        name: 'Modern Web Browser (Chrome, Safari, Firefox, Edge)',
      },
    ],
    step: steps.map((s, idx) => ({
      '@type': 'HowToStep',
      url: `${fullUrl}#step${idx + 1}`,
      name: s.name,
      itemListElement: [
        {
          '@type': 'HowToDirection',
          text: s.text,
        },
      ],
    })),
  };
}

export function buildFaqJsonLd(
  faqs: Array<{ question: string; answer: string }>
) {
  const siteUrl = getSiteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${siteUrl}/docs/faq#faq`,
    name: 'MUXARO Platform Engineering, Security & Policy FAQ',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    })),
  };
}

export function buildTechArticleJsonLd({
  title,
  description,
  path,
  publishedAt,
  updatedAt,
}: {
  title: string;
  description: string;
  path: string;
  publishedAt: string;
  updatedAt: string;
}) {
  const siteUrl = getSiteUrl();
  const fullUrl = `${siteUrl}${path}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${fullUrl}#article`,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': fullUrl,
    },
    headline: title,
    description,
    image: `${siteUrl}/brand/og-image.png`,
    author: {
      '@type': 'Organization',
      name: 'MUXARO Media Architecture & Systems Engineering Team',
      url: siteUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: 'MUXARO',
      url: siteUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${siteUrl}/brand/muxaro-mark.svg`,
      },
    },
    datePublished: publishedAt,
    dateModified: updatedAt,
    inLanguage: 'en-US',
  };
}

export function buildBreadcrumbsJsonLd(
  items: Array<{ name: string; path: string }>
) {
  const siteUrl = getSiteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.path === '/' ? `${siteUrl}/` : `${siteUrl}${item.path}`,
    })),
  };
}
