import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

const UPCOMING_AUDIO_MODULES = [
  {
    name: 'Source Stem Separation',
    spec: 'Isolate vocals, drums, bass, and instrumental beds locally with WebGPU / WASM inference.',
  },
  {
    name: 'Voice De-Noise & De-Reverb',
    spec: 'Remove fan hum, room echo, and mic plosives from spoken-word and podcast recordings.',
  },
  {
    name: 'Waveform Silence Trimmer',
    spec: 'Decode audio peaks via Web Audio API to cut dead air, apply fade curves, and export chapters.',
  },
  {
    name: 'Podcast Master & ID3 Batcher',
    spec: 'Chain EBU R128 loudness normalization, parametric EQ, and embedded cover-art metadata.',
  },
] as const;

export default function AudioRoadmapBand() {
  return (
    <section
      className="w-full bg-surface-elevated border-t border-line py-16"
      aria-labelledby="audio-roadmap-heading"
    >
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-5 space-y-4">
          <span
            role="status"
            className="inline-flex items-center px-2.5 py-1 rounded-full border border-line bg-surface text-xs font-medium text-content-secondary"
          >
            Next expansion
          </span>
          <h2
            id="audio-roadmap-heading"
            className="text-3xl sm:text-4xl font-display font-medium text-content tracking-[-0.02em]"
          >
            Dedicated Audio Studio arrives next
          </h2>
          <p className="text-sm text-content-secondary leading-relaxed">
            Built directly on top of our existing Audio Extractor, EBU R128 Normalizer, and A/V Sync Merger.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-4">
            <Link
              href="/tools/audio-extractor"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-hover transition-colors"
            >
              <span>Use Audio Extractor now</span>
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
            <Link
              href="/docs/audio-studio"
              className="text-xs font-semibold text-content hover:text-brand inline-flex items-center gap-1"
            >
              <span>Read Audio Studio roadmap</span>
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <dl className="lg:col-span-7 divide-y divide-line border-t border-b border-line">
          {UPCOMING_AUDIO_MODULES.map((mod) => (
            <div key={mod.name} className="py-4 sm:py-5 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4">
              <dt className="sm:col-span-5 text-sm font-semibold text-content">
                {mod.name}
              </dt>
              <dd className="sm:col-span-7 text-xs sm:text-sm text-content-secondary leading-relaxed">
                {mod.spec}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
