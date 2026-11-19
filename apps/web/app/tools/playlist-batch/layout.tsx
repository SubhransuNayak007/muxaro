import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildBreadcrumbsJsonLd,
} from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Playlist & Batch Processing Workspace | MUXARO',
  description:
    'Manage high-volume media processing queues, playlist jobs, and concurrent conversion tasks in one workspace.',
  path: '/tools/playlist-batch',
  keywords: [
    'playlist batch workspace',
    'high volume media processor',
    'playlist downloader',
    'batch conversion workspace',
  ],
});

export default function PlaylistBatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const softwareAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO Playlist & Batch Workspace',
    description:
      'Unified workspace for multi-track playlist processing, batch queues, and bulk media delivery.',
    path: '/tools/playlist-batch',
    features: [
      'Multi-source playlist and queue ingestion',
      'Real-time job progress tracking',
      'Direct ZIP download delivery',
      'Automatic resource management',
    ],
  });

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'Playlist & Batch', path: '/tools/playlist-batch' },
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
