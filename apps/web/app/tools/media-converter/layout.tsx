import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildBreadcrumbsJsonLd,
} from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Universal Media Format Converter | MUXARO',
  description:
    'Convert between MP4, WebM, MKV, MP3, AAC, and FLAC containers and codecs with granular control over bitrates, sample rates, and stream copying.',
  path: '/tools/media-converter',
  keywords: [
    'media converter',
    'convert video',
    'mp4 to mkv',
    'webm to mp4',
    'flac to mp3',
    'audio format converter',
    'video format converter',
  ],
});

export default function MediaConverterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const softwareAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO Universal Media Format Converter',
    description:
      'High-speed, browser-accessible media converter supporting MP4, WebM, MKV, MOV, MP3, AAC, and FLAC transcoding.',
    path: '/tools/media-converter',
    features: [
      'Multi-container conversion (MP4, MKV, WebM, MOV)',
      'Direct bitstream copy option for ultra-fast processing',
      'Granular bitrate and audio sample rate controls',
      'Zero-retention 60-minute automated storage purge',
    ],
  });

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'Media Converter', path: '/tools/media-converter' },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      {children}
    </>
  );
}
