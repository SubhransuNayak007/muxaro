'use client';

import React from 'react';
import Link from 'next/link';
import {
  Scissors,
  Minimize2,
  Sparkles,
  Smartphone,
  Captions,
  Volume2,
  ShieldCheck,
  Music,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';

interface ToolChainBarProps {
  jobId: string;
  title?: string;
  isAudioOnly?: boolean;
  excludeToolHref?: string;
}

const CHAIN_TARGETS = [
  {
    href: '/tools/video-trimmer',
    label: 'Trim or split 60s',
    kind: 'video' as const,
    Icon: Scissors,
  },
  {
    href: '/tools/video-compressor',
    label: 'Compress (10 MB / 16 MB)',
    kind: 'video' as const,
    Icon: Minimize2,
  },
  {
    href: '/tools/aspect-ratio-pad',
    label: 'Reframe 9:16',
    kind: 'video' as const,
    Icon: Smartphone,
  },
  {
    href: '/tools/subtitle-burner',
    label: 'Burn subtitles',
    kind: 'video' as const,
    Icon: Captions,
  },
  {
    href: '/tools/video-to-gif',
    label: 'Make GIF / WebP',
    kind: 'video' as const,
    Icon: Sparkles,
  },
  {
    href: '/tools/audio-normalizer',
    label: 'Normalize -14 LUFS',
    kind: 'all' as const,
    Icon: Volume2,
  },
  {
    href: '/tools/audio-extractor',
    label: 'Extract audio',
    kind: 'video' as const,
    Icon: Music,
  },
  {
    href: '/tools/metadata-scrubber',
    label: 'Scrub privacy tags',
    kind: 'all' as const,
    Icon: ShieldCheck,
  },
  {
    href: '/tools/media-converter',
    label: 'Convert format',
    kind: 'all' as const,
    Icon: RefreshCw,
  },
];

/**
 * Zero-reupload tool chaining bar rendered on completed jobs.
 */
export default function ToolChainBar({
  jobId,
  title,
  isAudioOnly = false,
  excludeToolHref,
}: ToolChainBarProps) {
  if (!jobId) return null;

  const filtered = CHAIN_TARGETS.filter((item) => {
    if (excludeToolHref && item.href === excludeToolHref) return false;
    if (isAudioOnly && item.kind === 'video') return false;
    return true;
  }).slice(0, 6);

  const query = new URLSearchParams({ sourceJobId: jobId });
  if (title) query.set('title', title);

  return (
    <div className="pt-3 border-t border-line/60 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-content">
          Continue in another tool
        </span>
        <span className="text-[11px] text-content-secondary">
          Zero re-upload · pipes directly into next step
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {filtered.map((item) => {
          const Icon = item.Icon;
          return (
            <Link
              key={item.href}
              href={`${item.href}?${query.toString()}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface text-xs font-medium text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content"
            >
              <Icon className="w-3.5 h-3.5 text-content-secondary" aria-hidden="true" />
              <span>{item.label}</span>
              <ArrowRight className="w-3 h-3 text-content-secondary" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
