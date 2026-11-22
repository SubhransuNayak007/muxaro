'use client';

import React from 'react';
import {
  Check,
  X,
  ShieldCheck,
  Sparkles,
  Zap,
  HardDrive,
  EyeOff,
  Layers,
  Volume2,
} from 'lucide-react';

interface ComparisonRow {
  feature: string;
  category: string;
  muxaro: {
    title: string;
    description: string;
    highlight: boolean;
  };
  legacy: {
    title: string;
    description: string;
    negative: boolean;
  };
  cloud: {
    title: string;
    description: string;
    negative: boolean;
  };
}

const COMPARISON_DATA: ComparisonRow[] = [
  {
    category: 'Integrity',
    feature: 'Ad-Free & Malware Protection',
    muxaro: {
      title: '100% Ad-Free Experience',
      description: 'Zero pop-unders, zero redirects, zero notification hijacks or fake buttons.',
      highlight: true,
    },
    legacy: {
      title: 'Deceptive Pop-ups & Scareware',
      description: 'Malvertising traps, fake "DOWNLOAD NOW" overlays, and notification hijacking.',
      negative: true,
    },
    cloud: {
      title: 'Banner Ads & Upgrade Prompts',
      description: 'Frequent countdown interstitials and conversion quota blockers.',
      negative: true,
    },
  },
  {
    category: 'Capacity',
    feature: 'Free File Size Limit',
    muxaro: {
      title: '4 GB Free File Allowance',
      description: '40x larger than typical converters; handles long podcasts, full movies, and 4K media.',
      highlight: true,
    },
    legacy: {
      title: 'Fails Above 500 MB',
      description: 'Frequent socket timeouts, broken chunk assembly, and silent download corruptions.',
      negative: true,
    },
    cloud: {
      title: 'Strict 100 MB Limit (Convertio)',
      description: 'Aggressive paywall requiring $9–$19/mo subscriptions or 25 min/day caps.',
      negative: true,
    },
  },
  {
    category: 'Fidelity',
    feature: 'Lossless Stream Copy vs Re-encoding',
    muxaro: {
      title: 'Lossless Stream Copy (Remux)',
      description: 'Direct FFmpeg container remuxing preserves original bitrates up to 8K with zero generational blur.',
      highlight: true,
    },
    legacy: {
      title: 'Forced 720p Re-compression',
      description: 'Downsamples high-res video; cannot remux DASH streams on web without desktop adware.',
      negative: true,
    },
    cloud: {
      title: 'Lossy Server Transcoding',
      description: 'CPU-throttled conversion queues that crush shadow detail and wash out color.',
      negative: true,
    },
  },
  {
    category: 'Audio Truth',
    feature: 'Audio Extraction Quality',
    muxaro: {
      title: 'Pure 320 kbps & Lossless FLAC',
      description: 'Bit-perfect audio stream extraction with genuine bitrate reporting—never fake upsampling.',
      highlight: true,
    },
    legacy: {
      title: 'Audio Fraud (128k to Fake 320k)',
      description: 'Pads 128 kbps audio into bloated 320k files while clipping highs above 15 kHz.',
      negative: true,
    },
    cloud: {
      title: 'Tier-Capped Bitrates',
      description: 'Locks studio-grade 320k and uncompressed FLAC behind subscription tiers.',
      negative: true,
    },
  },
  {
    category: 'Privacy',
    feature: 'Data Retention & Auto-Purge',
    muxaro: {
      title: '60-Minute Ephemeral Wipe',
      description: 'Automated cryptographic purge wipes files and metadata completely within 60 minutes.',
      highlight: true,
    },
    legacy: {
      title: 'Indefinite Third-Party Retention',
      description: 'Cached on public proxy mirrors with tracking pixels and ISP telemetry.',
      negative: true,
    },
    cloud: {
      title: '24-Hour File Logging',
      description: 'Retains files on shared cloud storage with permanent IP download logs.',
      negative: true,
    },
  },
  {
    category: 'Friction',
    feature: 'Watermarks & Software Installs',
    muxaro: {
      title: '100% Zero Watermarks / Zero Installs',
      description: 'Runs directly in modern browsers on desktop and mobile without extensions or binaries.',
      highlight: true,
    },
    legacy: {
      title: 'Requires Desktop Helpers',
      description: 'Forces .exe/.dmg desktop downloads (SaveFrom helper / 4K Downloader license locks).',
      negative: true,
    },
    cloud: {
      title: 'Branded Watermarks (Kapwing/Clideo)',
      description: 'Slaps large intrusive watermark logos on free exported video files.',
      negative: true,
    },
  },
];

export default function WhyChooseMuxaro() {
  return (
    <section
      aria-labelledby="comparison-heading"
      className="w-full pt-12 pb-16 border-t border-line"
    >
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-interactive border border-line text-xs font-semibold text-brand-violet dark:text-content mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-brand-violet" aria-hidden="true" />
            <span>Honest Media Engineering</span>
          </div>
          <h2
            id="comparison-heading"
            className="text-2xl sm:text-3xl font-extrabold text-content tracking-tight leading-snug"
          >
            Why Creators Choose MUXARO
          </h2>
          <p className="text-sm sm:text-base text-content-secondary mt-2 leading-relaxed">
            Engineered to replace bloated, ad-ridden web converters with a clean, high-performance lossless media studio.
          </p>
        </div>

        {/* Desktop & Tablet Comparison Matrix (Table View) */}
        <div className="hidden md:block rounded-2xl bg-surface border border-line shadow-card overflow-hidden">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">
              Feature comparison between MUXARO, legacy downloaders, and cloud converters
            </caption>
            <thead>
              <tr className="border-b border-line bg-surface-elevated/40">
                <th
                  scope="col"
                  className="py-4 px-6 text-xs font-semibold uppercase tracking-wider text-content-secondary w-1/4"
                >
                  Feature Specification
                </th>
                <th
                  scope="col"
                  className="py-4 px-6 text-xs font-bold text-brand-violet bg-interactive/60 border-x border-brand-violet/20 w-1/3"
                >
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                    <span>MUXARO (Lossless Engine)</span>
                  </div>
                </th>
                <th
                  scope="col"
                  className="py-4 px-6 text-xs font-semibold uppercase tracking-wider text-content-secondary w-1/5"
                >
                  Conventional Downloaders
                  <span className="block text-[10px] text-content-secondary font-normal lowercase">
                    (SaveFrom, Y2Mate clones)
                  </span>
                </th>
                <th
                  scope="col"
                  className="py-4 px-6 text-xs font-semibold uppercase tracking-wider text-content-secondary w-1/5"
                >
                  Generic Cloud Converters
                  <span className="block text-[10px] text-content-secondary font-normal lowercase">
                    (Convertio, CloudConvert)
                  </span>
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

                  {/* MUXARO Column (Highlighted) */}
                  <td className="py-4 px-6 align-top bg-interactive/30 border-x border-brand-violet/20">
                    <div className="flex items-start gap-2">
                      <div className="w-5 h-5 rounded-full bg-success/15 text-success flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-content">{row.muxaro.title}</p>
                        <p className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                          {row.muxaro.description}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Conventional Downloaders */}
                  <td className="py-4 px-6 align-top">
                    <div className="flex items-start gap-2">
                      <div className="w-5 h-5 rounded-full bg-error/10 text-error flex items-center justify-center shrink-0 mt-0.5">
                        <X className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-content">{row.legacy.title}</p>
                        <p className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                          {row.legacy.description}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Generic Cloud Converters */}
                  <td className="py-4 px-6 align-top">
                    <div className="flex items-start gap-2">
                      <div className="w-5 h-5 rounded-full bg-warning/10 text-warning flex items-center justify-center shrink-0 mt-0.5">
                        <X className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-content">{row.cloud.title}</p>
                        <p className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                          {row.cloud.description}
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
        <div className="md:hidden space-y-4">
          {COMPARISON_DATA.map((row) => (
            <div
              key={row.feature}
              className="rounded-2xl bg-surface border border-line p-5 shadow-card space-y-3"
            >
              <div className="border-b border-line pb-2">
                <span className="text-[10px] font-mono text-brand-violet uppercase tracking-wider font-semibold">
                  {row.category}
                </span>
                <h3 className="text-base font-bold text-content mt-0.5">{row.feature}</h3>
              </div>

              {/* MUXARO Primary */}
              <div className="p-3 rounded-xl bg-interactive/50 border border-brand-violet/30">
                <div className="flex items-center gap-1.5 text-xs font-bold text-brand-violet mb-1">
                  <Check className="w-4 h-4 text-success stroke-[2.5]" aria-hidden="true" />
                  <span>MUXARO (Lossless)</span>
                </div>
                <p className="text-sm font-bold text-content">{row.muxaro.title}</p>
                <p className="text-xs text-content-secondary mt-0.5 leading-snug">
                  {row.muxaro.description}
                </p>
              </div>

              {/* Others in comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs">
                <div className="p-2.5 rounded-lg bg-surface-elevated/50 border border-line">
                  <p className="text-[11px] font-semibold text-content-secondary mb-0.5">
                    Conventional Downloaders:
                  </p>
                  <p className="font-medium text-content">{row.legacy.title}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-elevated/50 border border-line">
                  <p className="text-[11px] font-semibold text-content-secondary mb-0.5">
                    Generic Cloud Converters:
                  </p>
                  <p className="font-medium text-content">{row.cloud.title}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
