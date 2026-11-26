'use client';

import React from 'react';
import {
  Check,
  X,
  ShieldCheck,
} from 'lucide-react';

interface ComparisonRow {
  feature: string;
  category: string;
  muxaro: {
    spec: string;
    detail: string;
  };
  downloaders: {
    spec: string;
    detail: string;
  };
  cloudConverters: {
    spec: string;
    detail: string;
  };
}

const COMPARISON_DATA: ComparisonRow[] = [
  {
    category: 'Engine',
    feature: 'Pure Stream Copy',
    muxaro: {
      spec: 'Direct Bitstream Remux',
      detail: 'Direct FFmpeg stream copy up to 8K. Zero re-encoding, zero generational loss.',
    },
    downloaders: {
      spec: 'Forced Lossy Re-encoding',
      detail: 'Downsamples to 720p or re-compresses container streams with visual artifacts.',
    },
    cloudConverters: {
      spec: 'Server CPU Transcoding',
      detail: 'CPU-throttled conversion queues with heavy bit-rate compression.',
    },
  },
  {
    category: 'Capacity',
    feature: '4 GB File Cap',
    muxaro: {
      spec: '4 GB Free Allowance',
      detail: 'Handles long 4K feature videos, podcasts, and audio stems without paywalls.',
    },
    downloaders: {
      spec: '< 500 MB File Limit',
      detail: 'Socket timeouts and broken chunk assembly on large payloads.',
    },
    cloudConverters: {
      spec: '100 MB Strict Limit',
      detail: 'Hard conversion cap requiring $9–$19/month subscription tiers.',
    },
  },
  {
    category: 'Security',
    feature: '0 Third-Party Scripts',
    muxaro: {
      spec: '100% Script-Isolated',
      detail: 'Zero ad networks, zero pop-unders, zero external trackers, and zero telemetry.',
    },
    downloaders: {
      spec: 'Intrusive Ad Networks',
      detail: 'Multiple redirect hops, deceptive banners, and third-party script injection.',
    },
    cloudConverters: {
      spec: 'Tracking & Telemetry',
      detail: 'Aggressive marketing trackers, cookies, and conversion quota paywalls.',
    },
  },
  {
    category: 'Retention',
    feature: '60-min Ephemeral Purge',
    muxaro: {
      spec: 'Cryptographic Auto-Purge',
      detail: 'All temporary files and job metadata are permanently wiped within 60 minutes.',
    },
    downloaders: {
      spec: 'Unmanaged Mirror Caching',
      detail: 'Cached on uncontrolled intermediate proxy servers with public access.',
    },
    cloudConverters: {
      spec: '24-Hour File Retention',
      detail: 'Kept on shared cloud storage volumes with persistent account logging.',
    },
  },
  {
    category: 'Acoustics',
    feature: 'Audio Extraction',
    muxaro: {
      spec: 'Studio FLAC & 320 kbps MP3',
      detail: 'Extracts native audio tracks with bit-accurate reporting; no fake upsampling.',
    },
    downloaders: {
      spec: 'Padded 128 kbps Audio',
      detail: 'Re-encodes low-bitrate streams into padded 320 kbps files with 15 kHz lowpass.',
    },
    cloudConverters: {
      spec: 'Tier-Restricted Audio',
      detail: 'Lossless FLAC and high-bitrate extractions locked behind premium plans.',
    },
  },
];

export default function WhyChooseMuxaro() {
  return (
    <section
      aria-labelledby="comparison-heading"
      className="w-full pt-10 pb-16 border-t border-line"
    >
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface border border-line text-xs font-semibold text-content-secondary mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-content" aria-hidden="true" />
            <span>Architecture &amp; Performance</span>
          </div>
          <h2
            id="comparison-heading"
            className="text-2xl sm:text-3xl font-extrabold text-content tracking-tight leading-snug"
          >
            Technical Comparison
          </h2>
          <p className="text-sm sm:text-base text-content-secondary mt-2 leading-relaxed">
            Objective comparison of processing pipelines, throughput limits, and data retention standards.
          </p>
        </div>

        {/* Desktop & Tablet Technical Comparison Matrix */}
        <div className="hidden md:block rounded-2xl bg-surface border border-line shadow-card overflow-hidden">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">
              Technical specification comparison between MUXARO, conventional downloaders, and cloud converters
            </caption>
            <thead>
              <tr className="border-b border-line bg-surface-elevated/40">
                <th
                  scope="col"
                  className="py-4 px-6 text-xs font-semibold uppercase tracking-wider text-content-secondary w-1/4"
                >
                  Specification
                </th>
                <th
                  scope="col"
                  className="py-4 px-6 text-xs font-bold text-content bg-surface-elevated border-x border-line w-1/3"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" aria-hidden="true" />
                    <span>MUXARO (Stream Copy Engine)</span>
                  </div>
                </th>
                <th
                  scope="col"
                  className="py-4 px-6 text-xs font-semibold uppercase tracking-wider text-content-secondary w-1/5"
                >
                  Standard Downloaders
                </th>
                <th
                  scope="col"
                  className="py-4 px-6 text-xs font-semibold uppercase tracking-wider text-content-secondary w-1/5"
                >
                  Generic Cloud Converters
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {COMPARISON_DATA.map((row) => (
                <tr key={row.feature} className="hover:bg-surface-elevated/20 transition-colors duration-150">
                  {/* Feature Title */}
                  <th scope="row" className="py-4 px-6 align-top">
                    <p className="text-sm font-semibold text-content">{row.feature}</p>
                    <span className="text-[11px] font-mono text-content-secondary uppercase tracking-wider">
                      {row.category}
                    </span>
                  </th>

                  {/* MUXARO Column (Highlighted with Clean Hairlines) */}
                  <td className="py-4 px-6 align-top bg-surface-elevated/30 border-x border-line">
                    <div className="flex items-start gap-2">
                      <div className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-content">{row.muxaro.spec}</p>
                        <p className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                          {row.muxaro.detail}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Standard Downloaders */}
                  <td className="py-4 px-6 align-top">
                    <div className="flex items-start gap-2">
                      <div className="w-5 h-5 rounded-full bg-surface-elevated text-content-secondary flex items-center justify-center shrink-0 mt-0.5">
                        <X className="w-3.5 h-3.5 stroke-[2]" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-content">{row.downloaders.spec}</p>
                        <p className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                          {row.downloaders.detail}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Generic Cloud Converters */}
                  <td className="py-4 px-6 align-top">
                    <div className="flex items-start gap-2">
                      <div className="w-5 h-5 rounded-full bg-surface-elevated text-content-secondary flex items-center justify-center shrink-0 mt-0.5">
                        <X className="w-3.5 h-3.5 stroke-[2]" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-content">{row.cloudConverters.spec}</p>
                        <p className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                          {row.cloudConverters.detail}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Responsive Cards (< md View) */}
        <div className="md:hidden space-y-3">
          {COMPARISON_DATA.map((row) => (
            <div
              key={row.feature}
              className="rounded-xl bg-surface border border-line p-4 shadow-xs space-y-3"
            >
              <div className="border-b border-line pb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-content">{row.feature}</h3>
                <span className="text-[11px] font-mono text-content-secondary font-medium">
                  {row.category}
                </span>
              </div>

              {/* MUXARO Primary Spec */}
              <div className="p-3 rounded-lg bg-surface-elevated border border-line">
                <div className="flex items-center gap-1.5 text-xs font-bold text-content mb-1">
                  <Check className="w-3.5 h-3.5 text-emerald-500 stroke-[2.5]" aria-hidden="true" />
                  <span>MUXARO</span>
                </div>
                <p className="text-xs font-bold text-content">{row.muxaro.spec}</p>
                <p className="text-[11px] text-content-secondary mt-0.5 leading-snug">
                  {row.muxaro.detail}
                </p>
              </div>

              {/* Other Solutions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-surface/50 border border-line/60">
                  <p className="text-[11px] font-semibold text-content-secondary mb-0.5">
                    Standard downloaders
                  </p>
                  <p className="font-medium text-content text-[11px]">{row.downloaders.spec}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-surface/50 border border-line/60">
                  <p className="text-[11px] font-semibold text-content-secondary mb-0.5">
                    Cloud converters
                  </p>
                  <p className="font-medium text-content text-[11px]">{row.cloudConverters.spec}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
