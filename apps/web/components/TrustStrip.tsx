'use client';

import React from 'react';

export default function TrustStrip() {
  return (
    <div className="w-full max-w-3xl mx-auto mt-4 px-4 py-2.5 rounded-full border border-line bg-surface/60 text-xs text-content-secondary flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center select-none shadow-xs font-mono">
      <span>Instant Cloud Processing (≤ 2K)</span>
      <span className="text-content-muted" aria-hidden="true">·</span>
      <span>8K Local Ultra HD</span>
      <span className="text-content-muted" aria-hidden="true">·</span>
      <span>Studio Audio (FLAC · MP3)</span>
      <span className="text-content-muted" aria-hidden="true">·</span>
      <span>Zero Ads & 100% Private</span>
    </div>
  );
}
