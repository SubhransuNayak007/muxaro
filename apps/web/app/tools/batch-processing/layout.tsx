import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
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
      'High-throughput multi-item media processing queue with individualized conversion settings.',
    path: '/tools/batch-processing',
    features: [
      'Multi-link concurrent processing queue',
      'Individualized per-item output format selection',
      'Unified progress monitoring and batch ZIP download',
      'Automatic resource management and rate limit shielding',
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      {children}
    </>
  );
}
