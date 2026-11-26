import React from 'react';
import type { Metadata } from 'next';
import { constructMetadata } from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Thumbnail Extractor — HD & 4K Cover Downloader | MUXARO',
  description:
    'Inspect and download high-resolution video thumbnails (1280x720 HD, 640x480, 480x360) and timeline frames from YouTube and 1,000+ platforms.',
  path: '/tools/thumbnail-extractor',
  keywords: ['thumbnail downloader', 'youtube thumbnail extractor', 'hd thumbnail grabber'],
});

export default function ThumbnailExtractorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
