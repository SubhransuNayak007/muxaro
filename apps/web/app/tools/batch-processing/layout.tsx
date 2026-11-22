import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
  buildBreadcrumbsJsonLd,
} from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Batch Media Processing — Multi-Link Queue | MUXARO',
  description:
    'Queue multiple media links and video files simultaneously with individualized preset configurations and parallel processing.',
  path: '/tools/batch-processing',
  keywords: [
    'batch media processing',
    'bulk video download',
    'batch media converter',
    'queue video conversions',
    'multi-link downloader',
    'batch download mp3',
  ],
});

export default function BatchProcessingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const softwareAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO Batch Media Processor',
    description:
      'High-throughput multi-item media processing queue with individualized conversion settings and concurrent execution.',
    path: '/tools/batch-processing',
    features: [
      'Multi-link concurrent processing queue',
      'Individualized per-item output format selection (MP4, MKV, MP3, FLAC)',
      'Unified progress monitoring and batch ZIP download delivery',
      'Automatic resource management and rate limit shielding',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to Process and Convert Multiple Media Files in Batch',
    description:
      'Guide to queueing and converting multiple video links or files simultaneously with customized output presets.',
    path: '/tools/batch-processing',
    steps: [
      {
        name: 'Input Media URLs or Upload Batch Files',
        text: 'Add multiple media URLs or select local files to populate the queue.',
      },
      {
        name: 'Assign Format Presets',
        text: 'Configure target resolution and audio/video containers for each queue item.',
      },
      {
        name: 'Execute Batch Queue and Download ZIP',
        text: 'Run the batch queue and download the completed files packaged as a unified archive.',
      },
    ],
  });

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'Batch Processing', path: '/tools/batch-processing' },
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
