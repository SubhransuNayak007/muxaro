import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
  buildBreadcrumbsJsonLd,
} from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Lossless Audio Extractor — Direct Bitstream Demuxing | MUXARO',
  description:
    'Extract native AAC, Opus, and MP3 audio tracks directly from video containers with zero quality loss. No fake upsampling, pure bitstream extraction.',
  path: '/tools/audio-extractor',
  keywords: [
    'lossless audio extractor',
    'extract audio from video',
    'demux audio',
    'direct bitstream extraction',
    'opus extractor',
    'aac extractor',
    'mp3 320kbps',
  ],
});

export default function AudioExtractorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const softwareAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO Lossless Audio Extractor',
    description:
      'Extract native bitstream audio tracks (Opus, AAC, MP3) directly from media containers with zero generational loss.',
    path: '/tools/audio-extractor',
    features: [
      'Direct bitstream copy (-c:a copy)',
      'Zero quality loss extraction',
      'Instant container stream inspection',
      'Supports MP4, WebM, MKV, MOV, and AVI',
      '100% in-browser offline processing (zero server uploads)',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to Extract Lossless Audio from Video with Zero Quality Loss',
    description:
      'Step-by-step technical guide to extracting native bitstream audio tracks from video containers without transcoding.',
    path: '/tools/audio-extractor',
    steps: [
      {
        name: 'Select or Drop Video File',
        text: 'Select or drop your video container file directly in your browser.',
      },
      {
        name: 'Select Audio Extraction Mode',
        text: 'Choose Original bitstream copy for zero quality loss in 1-2 seconds, or select MP3, AAC, WAV, or FLAC.',
      },
      {
        name: 'Download Extracted Audio Track',
        text: 'Extract client-side in seconds and download your isolated audio track instantly with zero server round-trips.',
      },
    ],
  });

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'Audio Extractor', path: '/tools/audio-extractor' },
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
