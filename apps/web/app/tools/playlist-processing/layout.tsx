import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildBreadcrumbsJsonLd,
} from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Playlist Processing — Up to 50 Items | MUXARO',
  description:
    'Process entire video playlists up to 50 items with automated archiving and single-click ZIP delivery.',
  path: '/tools/playlist-processing',
  keywords: [
    'playlist processing',
    'download playlist',
    'playlist to zip',
    'bulk playlist extraction',
    'convert playlist to mp3',
  ],
});

export default function PlaylistProcessingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const softwareAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO Playlist Processing Suite',
    description:
      'Automated playlist parsing, batch execution, and ZIP archive bundle packaging up to 50 items.',
    path: '/tools/playlist-processing',
    features: [
      'Full playlist discovery and item extraction',
      'Unified single-click ZIP packaging',
      'Up to 50 items per playlist job',
      'Daily playlist quota entitlement management',
    ],
  });

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'Playlist Processing', path: '/tools/playlist-processing' },
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
