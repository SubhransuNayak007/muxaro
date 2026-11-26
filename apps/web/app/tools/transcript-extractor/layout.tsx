import React from 'react';
import type { Metadata } from 'next';
import { constructMetadata } from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Transcript & Subtitle Extractor (.TXT, .SRT, .VTT) | MUXARO',
  description:
    'Extract clean, deduplicated video transcripts and multi-language subtitles from YouTube and online videos in TXT, SRT, VTT, and Markdown.',
  path: '/tools/transcript-extractor',
  keywords: ['transcript extractor', 'youtube transcript', 'subtitle downloader', 'srt vtt txt'],
});

export default function TranscriptExtractorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
