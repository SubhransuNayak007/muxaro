import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
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
    '4gb media converter',
    'lossless stream copy',
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
      'High-speed, browser-accessible media converter supporting MP4, WebM, MKV, MOV, MP3, AAC, and FLAC transcoding up to 4 GB with zero ads.',
    path: '/tools/media-converter',
    features: [
      'Multi-container conversion (MP4, MKV, WebM, MOV, FLAC, MP3)',
      'Direct bitstream copy option (-c copy) for ultra-fast processing under 3 seconds',
      'Granular bitrate and audio sample rate controls',
      'Zero-retention 60-minute automated storage purge',
      '4 GB free file processing with zero ads',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to Convert Video and Audio Containers Online Without Quality Loss',
    description:
      'Step-by-step technical guide to converting between MP4, MKV, WebM, MOV, MP3, and FLAC containers using stream copying.',
    path: '/tools/media-converter',
    steps: [
      {
        name: 'Select Media Source or Upload File',
        text: 'Paste a video stream URL or select your local file up to 4 GB to inspect available video and audio streams.',
      },
      {
        name: 'Choose Output Container & Codec Strategy',
        text: 'Select your target container (MP4, MKV, WebM, MOV, MP3, FLAC). Choose Direct Stream Copy for instant loss-free conversion if codecs align, or select high-efficiency transcoding.',
      },
      {
        name: 'Process and Download Converted File',
        text: 'Click Convert to run the stream demuxing engine and download your rendered media file instantly.',
      },
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
