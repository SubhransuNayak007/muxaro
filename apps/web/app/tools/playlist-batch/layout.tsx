import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
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
    'download youtube playlist zip',
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
      'Unified workspace for multi-track playlist processing, batch queues, and bulk media delivery up to 50 items.',
    path: '/tools/playlist-batch',
    features: [
      'Multi-source playlist and queue ingestion up to 50 items',
      'Real-time job progress tracking with live Server-Sent Events',
      'Direct ZIP download delivery with zero compression loss',
      'Automatic resource management and ephemeral 60-minute cleanup',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to Download and Convert Full Video Playlists to ZIP',
    description:
      'Step-by-step walkthrough to parsing video playlists, queueing items, and downloading them in a single ZIP archive.',
    path: '/tools/playlist-batch',
    steps: [
      {
        name: 'Submit Playlist Link',
        text: 'Paste the public or unlisted playlist URL to retrieve all available video items.',
      },
      {
        name: 'Select Target Quality and Container',
        text: 'Choose your desired output format (MP4, MP3, FLAC) and resolution preset for the batch.',
      },
      {
        name: 'Start Processing and Download ZIP',
        text: 'Run the batch pipeline and download the indexed, numbered media files in one archive.',
      },
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
