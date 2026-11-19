import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
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
      'Seamless multi-clip video concatenation utility with presentation timestamp synchronization.',
    path: '/tools/video-merger',
    features: [
      'Multi-clip video concatenation',
      'Smooth frame and timestamp alignment',
      'Support for uniform codec stream stitching',
      'Downloadable as unified continuous MP4/MKV',
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      {children}
    </>
  );
}
