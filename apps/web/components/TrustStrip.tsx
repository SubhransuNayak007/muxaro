'use client';

import React from 'react';
import { ShieldCheck, HardDrive, Zap, Clock } from 'lucide-react';

interface TrustPillar {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  detail: string;
}

const TRUST_PILLARS: TrustPillar[] = [
  {
    icon: ShieldCheck,
    title: '100% Ad-Free',
    subtitle: 'Zero pop-ups or click-traps',
    detail: 'No redirects, intrusive third-party scripts, or malware download buttons.',
  },
  {
    icon: HardDrive,
    title: '4 GB Free Limit',
    subtitle: '40x standard web converters',
    detail: 'Process large 4K videos, podcasts, and master audio stems without paywalls.',
  },
  {
    icon: Zap,
    title: 'Lossless Stream Copy',
    subtitle: 'Bitstream remuxing',
    detail: 'Direct container remuxing preserves native bitrates with zero generational quality loss.',
  },
  {
    icon: Clock,
    title: '60-Min Auto-Wipe',
    subtitle: 'Complete data privacy',
    detail: 'Temporary files and metadata are cryptographically purged after 60 minutes.',
  },
];

export default function TrustStrip() {
  return (
    <section
      aria-label="Core reliability and privacy guarantees"
      className="w-full py-6 mt-2"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {TRUST_PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <div
              key={pillar.title}
              className="p-3.5 sm:p-4 rounded-xl bg-surface border border-line shadow-sm hover:border-brand-violet/40 transition-colors duration-150 flex items-start gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg bg-interactive text-brand-violet flex items-center justify-center shrink-0 mt-0.5"
                aria-hidden="true"
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="text-xs sm:text-sm font-bold text-content tracking-tight">
                    {pillar.title}
                  </h3>
                </div>
                <p className="text-[11px] font-semibold text-brand-violet dark:text-content-secondary mt-0.5">
                  {pillar.subtitle}
                </p>
                <p className="text-[11px] text-content-secondary mt-1 leading-snug line-clamp-2">
                  {pillar.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
