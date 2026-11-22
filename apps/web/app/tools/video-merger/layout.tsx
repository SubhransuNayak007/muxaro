import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
  buildBreadcrumbsJsonLd,
} from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Video Clip Joiner — Seamless Multi-Clip Concatenation | MUXARO',
  description:
    'Join multiple video clips into one continuous file with smooth frame alignment and native container compatibility.',
  path: '/tools/video-merger',
  keywords: [
    'video clip joiner',
    'combine videos',
    'concatenate mp4',
    'video merger online',
    'stitch video clips',
    'merge clips without watermark',
  ],
});

export default function VideoMergerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const softwareAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO Video Clip Joiner',
    description:
      'Seamless multi-clip video concatenation utility with presentation timestamp synchronization and zero watermarks.',
    path: '/tools/video-merger',
    features: [
      'Multi-clip video concatenation up to 4 GB',
      'Smooth frame and presentation timestamp (PTS) alignment',
      'Support for uniform codec stream stitching without re-encoding',
      'Downloadable as unified continuous MP4/MKV with zero watermark',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to Join Multiple Video Clips Online into One File',
    description:
      'Step-by-step guide to concatenating multiple MP4 or MKV clips into a continuous video stream without quality loss.',
    path: '/tools/video-merger',
    steps: [
      {
        name: 'Upload Video Clips',
        text: 'Add two or more video files in the order you want them merged.',
      },
      {
        name: 'Configure Sequence & Alignment',
        text: 'Arrange playback sequence and confirm resolution and codec compatibility.',
      },
      {
        name: 'Concatenate and Export',
        text: 'Merge clips into a seamless single video container and download immediately.',
      },
    ],
  });

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'Video Merger', path: '/tools/video-merger' },
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
