'use client';

import React from 'react';

interface SpecMetric {
  metric: string;
  label: string;
  spec: string;
}

const SPEC_METRICS: SpecMetric[] = [
  {
    metric: '100%',
    label: 'Ad-Free',
    spec: 'Zero pop-ups or tracking scripts',
  },
  {
    metric: '4 GB',
    label: 'Free Limit',
    spec: 'Direct bitstream allowance per job',
  },
  {
    metric: '8K',
    label: 'Stream Copy',
    spec: 'Lossless remuxing with zero quality loss',
  },
  {
    metric: '60 min',
    label: 'Auto-Wipe',
    spec: 'Ephemeral storage cryptographically purged',
  },
];

export default function TrustStrip() {
  return (
    <section
      aria-label="Technical specifications and privacy guarantees"
      className="w-full py-4 mt-2"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 rounded-xl border border-line bg-surface/80 divide-y lg:divide-y-0 divide-line lg:divide-x shadow-xs">
        {SPEC_METRICS.map((item) => (
          <div
            key={item.label}
            className="p-3.5 sm:p-4 flex flex-col justify-center"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-base sm:text-lg font-bold text-content tabular-nums tracking-tight">
                {item.metric}
              </span>
              <span className="text-[11px] font-semibold text-content uppercase tracking-wider">
                {item.label}
              </span>
            </div>
            <p className="text-[11px] text-content-secondary mt-1 leading-snug">
              {item.spec}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
