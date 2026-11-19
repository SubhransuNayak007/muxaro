import React from 'react';
import Link from 'next/link';
import {
  Music,
  Film,
  Combine,
  RefreshCw,
  Layers,
  ListVideo,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
import { constructMetadata, buildBreadcrumbsJsonLd } from '@/lib/seo';

export const metadata = constructMetadata({
  title: 'Creator Media Processing Tools | MUXARO',
  description:
    'High-integrity creator tools for lossless audio extraction, stream copy remuxing, video conversion, and batch playlist processing.',
  path: '/tools',
  keywords: [
    'creator media tools',
    'lossless audio extractor',
    'audio video merger',
    'video format converter',
    'batch media processing',
    'playlist downloader',
  ],
});

const TOOLS = [
  {
    href: '/tools/media-converter',
    title: 'Convert video & audio',
    description:
      'Switch between MP4, MKV, WebM, MOV, MP3, and FLAC while keeping crisp original quality.',
    tag: 'Multi-format',
    Icon: RefreshCw,
  },
  {
    href: '/tools/audio-extractor',
    title: 'Extract audio',
    description:
      'Save the original audio track with zero quality loss, or export to FLAC, WAV, or MP3.',
    tag: 'Lossless & MP3',
    Icon: Music,
  },
  {
    href: '/tools/audio-video-merger',
    title: 'Merge video & audio',
    description:
      'Combine separate video and audio files with precise millisecond sync adjustment.',
    tag: 'Track sync',
    Icon: Combine,
  },
  {
    href: '/tools/video-merger',
    title: 'Join video clips',
    description:
      'Combine multiple video clips into one continuous file with smooth frame alignment.',
    tag: 'Clip joiner',
    Icon: Film,
  },
  {
    href: '/tools/batch-processing',
    title: 'Batch processing',
    description:
      'Queue multiple media links at once with tailored format choices for faster turnaround.',
    tag: 'Multi-file',
    Icon: Layers,
  },
  {
    href: '/tools/playlist-processing',
    title: 'Playlist processing',
    description:
      'Process authorised playlists up to 50 items and download everything in one ZIP archive.',
    tag: 'Up to 50 items',
    Icon: ListVideo,
  },
];

export default function ToolsIndexPage() {
  const breadcrumbJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
  ]);

  return (
    <div className="w-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="mb-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Back to workspace</span>
            </Link>
          </div>

          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-brand-violet/30 text-xs font-semibold text-brand-violet mb-4 shadow-xs">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>All media tools in one place</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Standalone media tools
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Convert formats, extract audio, merge tracks, or process multiple files at once with zero artificial degradation.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {TOOLS.map(({ href, title, description, tag, Icon }) => (
            <Link
              key={href}
              href={href}
              className="deepseek-input-card p-6 flex flex-col justify-between group hover:border-brand-violet/50 hover:shadow-md transition-shadow"
            >
              <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-surface border border-line flex items-center justify-center text-brand-violet shadow-xs group-hover:scale-105 transition-transform">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-surface border border-line text-content-secondary">
                    {tag}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-content mb-2 group-hover:text-brand-violet transition-colors">
                  {title}
                </h2>
                <p className="text-sm text-content-secondary leading-relaxed mb-6">
                  {description}
                </p>
              </div>

              <div className="pt-4 border-t border-line flex items-center justify-between text-sm font-semibold text-brand-violet">
                <span>Open tool</span>
                <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" aria-hidden="true" />
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-10 deepseek-input-card p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-sm">
          <div className="max-w-xl">
            <h2 className="text-lg font-bold text-content mb-1.5">
              Working with playlists and batches together?
            </h2>
            <p className="text-sm text-content-secondary leading-relaxed">
              Open the combined playlist and batch workspace to queue individual links or package an authorised playlist into a single ZIP download.
            </p>
          </div>
          <Link
            href="/tools/playlist-batch"
            className="px-6 py-3 rounded-full bg-brand-violet text-white text-sm font-semibold hover:bg-brand-violet/90 active:scale-[0.98] transition-transform shadow-xs inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            <span>Open batch hub</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
