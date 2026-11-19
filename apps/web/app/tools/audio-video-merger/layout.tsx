import React from 'react';
import type { Metadata } from 'next';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
  buildBreadcrumbsJsonLd,
} from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Audio-Video Stream Merger — Zero-Loss Remuxing | MUXARO',
  description:
    'Combine separate 1080p, 4K, and 8K DASH video and audio streams into single MP4 or MKV containers with millisecond timestamp synchronization.',
  path: '/tools/audio-video-merger',
  keywords: [
    'audio video merger',
    'merge video and audio',
    'multiplex dash streams',
    'sync audio with video',
    'remux mp4',
    'combine tracks without re-encoding',
  ],
});

export default function AudioVideoMergerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const softwareAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO Audio-Video Stream Merger',
    description:
      'Combine disjoint high-resolution video streams and high-fidelity audio tracks into unified containers with zero transcoding loss.',
    path: '/tools/audio-video-merger',
    features: [
      'Disjoint DASH/HLS video and audio stream combining',
      'Presentation timestamp (PTS) sync alignment',
      'Lossless container remuxing without transcoding',
      'Supports 1080p, 1440p, 4K UHD, and 8K FUHD video sources',
      'Sub-second stream multiplexing with zero quality degradation',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to Merge Separate Video and Audio Tracks with Perfect Sync',
    description:
      'Step-by-step engineering walkthrough for combining disjoint video and audio streams without transcoding.',
    path: '/tools/audio-video-merger',
    steps: [
      {
        name: 'Input Video & Audio Tracks',
        text: 'Provide your video track and audio source via link or container upload.',
      },
      {
        name: 'Align Timestamp Synchronization',
        text: 'Review stream duration alignment and adjust millisecond delay if compensating for audio lag.',
      },
      {
        name: 'Generate Multiplexed Media Container',
        text: 'Export as MP4 or MKV and download your synced video file instantly.',
      },
    ],
  });

  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'Audio-Video Merger', path: '/tools/audio-video-merger' },
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
