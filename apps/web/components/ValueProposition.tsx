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
    subtitle: 'Up to 2K stream copy on any device',
    description:
      'Runs directly in the browser with zero setup. Streams clean video and audio from supported hosts without re-encoding.',
    details: [
      'Up to 1440p (2K) remuxing',
      'No extensions or scripts required',
      'Works on iOS, Android, and desktop',
    ],
    icon: Cloud,
  },
  {
    id: 'direct',
    badge: 'Desktop Only',
    title: 'Direct Mode',
    subtitle: 'Up to 8K over your own connection',
    description:
      'Splices streams inside your desktop browser via our lightweight bridge, avoiding cloud rate limits completely.',
    details: [
      'Full 4K and 8K 60fps bitstream copy',
      'Parallel range streaming locally',
      'Uses your home IP with zero throttle',
    ],
    actionLabel: 'Set up Desktop Direct',
    actionHref: '/tools/direct-helper',
    icon: Laptop,
  },
  {
    id: 'studio',
    badge: '100% Private',
    title: 'Studio Tools',
    subtitle: 'In-browser convert, extract & merge',
    description:
      'Powered by WebAssembly FFmpeg inside your tab. Convert formats or extract audio without uploading files.',
    details: [
      'Zero server uploads',
      'Hardware-friendly remuxing',
      '2–5 second local turnaround',
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
        <div className="text-center max-w-2xl mx-auto mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface border border-line text-xs font-medium text-content-secondary mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-content shrink-0" aria-hidden="true" />
            <span>Pipeline Architecture</span>
          </div>
          <h2
            id="value-prop-heading"
            className="text-2xl sm:text-3xl font-extrabold text-content tracking-tight leading-snug"
          >
            Three modes. Clear limits.
          </h2>
          <p className="text-sm sm:text-base text-content-secondary mt-2 leading-relaxed">
            Choose the route that fits your device and resolution.
          </p>
        </div>

        {/* 3-Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.id}
                className="muxaro-card muxaro-card-interactive p-6 flex flex-col justify-between group"
              >
                <div>
                  {/* Top Bar with Icon and Badge */}
                  <div className="flex items-center justify-between gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-surface-elevated border border-line flex items-center justify-center text-content shrink-0">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <span className="text-[11px] font-mono font-medium px-2.5 py-1 rounded-full bg-surface-elevated border border-line text-content-secondary">
                      {pillar.badge}
                    </span>
                  </div>

                  {/* Title & Concise Subtitle */}
                  <h3 className="text-lg font-bold text-content mb-1">
                    {pillar.title}
                  </h3>
                  <p className="text-sm font-medium text-content mb-2.5 leading-snug">
                    {pillar.subtitle}
                  </p>
                  <p className="text-xs sm:text-sm text-content-secondary leading-relaxed mb-4">
                    {pillar.description}
                  </p>

                  {/* Feature Checklist */}
                  <ul className="space-y-2 border-t border-line-subtle pt-4 mb-5">
                    {pillar.details.map((detail, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-content-secondary">
                        <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Optional Action Link */}
                {pillar.actionHref && pillar.actionLabel ? (
                  <Link
                    href={pillar.actionHref}
                    className="inline-flex items-center justify-between text-xs font-semibold text-content hover:text-brand transition-colors pt-3 border-t border-line-subtle"
                  >
                    <span>{pillar.actionLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                ) : (
                  <div className="text-[11px] font-mono text-content-muted pt-3 border-t border-line-subtle select-none">
                    Native web — Always available
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
