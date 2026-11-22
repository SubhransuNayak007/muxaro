import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
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
    'youtube playlist archiver',
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
      'Full playlist discovery and item extraction up to 50 items',
      'Unified single-click ZIP packaging with zero loss',
      'Lossless stream extraction for all audio and video formats',
      'Daily playlist quota entitlement management with zero ads',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to Process and Archive Entire Playlists Online',
    description:
      'Step-by-step engineering walkthrough for converting and packaging up to 50 playlist tracks into a structured archive.',
    path: '/tools/playlist-processing',
    steps: [
      {
        name: 'Enter Playlist URL',
        text: 'Paste the public or unlisted playlist URL to index all video tracks.',
      },
      {
        name: 'Configure Audio/Video Format',
        text: 'Select your preferred container and bitrate presets across the playlist items.',
      },
      {
        name: 'Archive and Download',
        text: 'Execute processing and receive a clean ZIP archive with zero-padded numbered filenames.',
      },
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
