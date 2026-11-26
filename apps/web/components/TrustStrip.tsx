'use client';

import React from 'react';

const HIGHLIGHTS = [
  'Cloud Stream Copy up to 2K',
  'Local Direct up to 8K',
  'Lossless FLAC & 320 kbps Audio',
  'Zero Ads & Private',
] as const;

export default function TrustStrip() {
  return (
    <div className="w-full max-w-3xl mx-auto mt-4 flex flex-wrap items-center justify-center gap-2 select-none">
      {HIGHLIGHTS.map((item) => (
        <span
          key={item}
          className="px-3 py-1 rounded-full border border-line bg-surface/80 text-xs font-mono text-content-secondary"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
