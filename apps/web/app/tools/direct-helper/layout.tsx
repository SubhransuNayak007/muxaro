import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
  buildBreadcrumbsJsonLd,
} from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Direct Stream Inspector & Helper | MUXARO',
  description:
    'Inspect, analyze, and directly stream media assets with client-side acceleration and RFC 9110 range resumption.',
  path: '/tools/direct-helper',
  keywords: [
    'direct stream inspector',
    'stream helper',
    'inspect media url',
    'direct cdn downloader',
    'range resumption downloader',
  ],
});

export default function DirectHelperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const softwareAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO Direct Stream Inspector & Helper',
    description:
      'Client-accelerated media stream inspector and range-resumable direct downloader for YouTube, TikTok, Instagram, and Twitter.',
    path: '/tools/direct-helper',
    features: [
      'Direct 302 CDN stream inspection',
      'RFC 9110 HTTP Range header multi-threaded streaming',
      'Instant container format and bitrate detection',
      'Zero-ad privacy with 60-minute automatic purge',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to Inspect and Accelerate Media Downloads with Direct Helper',
    description:
      'Step-by-step instructions for inspecting media stream manifests and directly downloading assets via CDN acceleration.',
    path: '/tools/direct-helper',
    steps: [
      {
        name: 'Submit Media Stream URL',
        text: 'Paste any supported video URL into the inspector box.',
      },
      {
        name: 'Analyze Available Streams',
        text: 'Review progressive MP4, adaptive video, and lossless audio streams detected by the engine.',
      },
      {
        name: 'Initiate Direct Download',
        text: 'Trigger accelerated direct stream downloading directly from origin CDNs.',
      },
    ],
  });

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'Direct Helper', path: '/tools/direct-helper' },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      {children}
    </>
  );
}
