'use client';

import React from 'react';
import Link from 'next/link';
import { Cloud, Laptop, Cpu, ArrowRight, ShieldCheck, Check } from 'lucide-react';

interface ValuePillar {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  description: string;
  details: string[];
  actionLabel?: string;
  actionHref?: string;
  icon: React.ElementType;
}

const PILLARS: ValuePillar[] = [
  {
    id: 'cloud',
    badge: 'Mobile & Web',
    title: 'Cloud Mode',
    subtitle: 'Up to 2K lossless stream copy for open & supported hosts',
    description:
      'Zero installation required. Streams line-speed audio and video copy directly from supported open platforms without downloading or re-encoding on your device.',
    details: [
      'Up to 1440p (2K) stream remuxing',
      'No browser extensions or helper scripts',
      'Instant delivery on iPhone, Android, & laptops',
    ],
    icon: Cloud,
  },
  {
    id: 'direct',
    badge: 'Desktop Only',
    title: 'Direct Mode',
    subtitle: 'Up to 8K via local browser bridge using your own residential connection',
    description:
      'Eliminates bot blocks and free cloud IP bans. Streams directly through your browser via a lightweight companion userscript or Chrome extension using your home IP address.',
    details: [
      'Full 4K and 8K 60fps bitstream copy',
      'Uses your own residential connection',
      'Bypasses datacenter bot-blocking completely',
    ],
    actionLabel: 'Set up Desktop Direct',
    actionHref: '/tools/direct-helper',
    icon: Laptop,
  },
  {
    id: 'studio',
    badge: '100% Private',
    title: 'Studio Tools',
    subtitle: '100% private in-browser conversion, audio extraction, and audio/video merging',
    description:
      'Powered by client-side WebAssembly FFmpeg. Convert video containers, extract lossless audio, or multiplex streams without uploading a single byte to external servers.',
    details: [
      'Client-side WebAssembly FFmpeg engine',
      'Zero server uploads — 100% private in tab',
      'Instant container remuxing in 2–5 seconds',
    ],
    actionLabel: 'Open Studio Tools',
    actionHref: '/tools',
    icon: Cpu,
  },
];

export default function ValueProposition() {
  return (
    <section
      aria-labelledby="value-prop-heading"
      className="w-full pt-10 pb-8"
    >
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface border border-line text-xs font-semibold text-content-secondary mb-3 shadow-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-brand-violet dark:text-brand-violet-hover" aria-hidden="true" />
            <span>Honest Media Pipeline Architecture</span>
          </div>
          <h2
            id="value-prop-heading"
            className="text-2xl sm:text-3xl font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight leading-snug"
          >
            Three transparent modes. Zero false promises.
          </h2>
          <p className="text-sm sm:text-base text-content-secondary mt-2 leading-relaxed">
            We don&apos;t make fake claims about unlimited free cloud servers. Here is exactly how MUXARO handles media across devices.
          </p>
        </div>

        {/* 3-Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.id}
                className="rounded-2xl border border-line bg-surface p-6 sm:p-7 flex flex-col justify-between shadow-card hover:border-line-hover transition-colors group relative overflow-hidden"
              >
                <div>
                  {/* Top Bar with Icon and Badge */}
                  <div className="flex items-center justify-between gap-3 mb-5">
                    <div className="w-11 h-11 rounded-xl bg-surface-elevated border border-line flex items-center justify-center text-zinc-900 dark:text-zinc-100 group-hover:text-brand-violet transition-colors">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-surface-elevated border border-line text-content-secondary">
                      {pillar.badge}
                    </span>
                  </div>

                  {/* Title & Honest Value Proposition Subtitle */}
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1">
                    {pillar.title}
                  </h3>
                  <p className="text-sm font-semibold text-brand-violet dark:text-brand-violet-hover mb-3 leading-snug">
                    {pillar.subtitle}
                  </p>
                  <p className="text-xs sm:text-sm text-content-secondary leading-relaxed mb-5">
                    {pillar.description}
                  </p>

                  {/* Feature Checklist */}
                  <ul className="space-y-2 border-t border-line/60 pt-4 mb-6">
                    {pillar.details.map((detail, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-content-secondary">
                        <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Optional Action Link */}
                {pillar.actionHref && pillar.actionLabel ? (
                  <Link
                    href={pillar.actionHref}
                    className="inline-flex items-center justify-between text-xs font-semibold text-zinc-900 dark:text-zinc-100 hover:text-brand-violet dark:hover:text-brand-violet transition-colors pt-3 border-t border-line"
                  >
                    <span>{pillar.actionLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                ) : (
                  <div className="text-[11px] font-mono text-content-muted pt-3 border-t border-line select-none">
                    Native web · Always available
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
