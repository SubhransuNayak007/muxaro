'use client';

import React from 'react';

export default function TrustStrip() {
  return (
    <div className="w-full max-w-3xl mx-auto mt-4 px-4 py-2.5 rounded-full border border-line bg-surface/60 text-xs text-content-secondary flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center select-none shadow-xs font-mono">
      <span>Up to 8K stream copy</span>
      <span className="text-content-muted" aria-hidden="true">·</span>
      <span>4 GB file limit</span>
      <span className="text-content-muted" aria-hidden="true">·</span>
      <span>Zero ads</span>
      <span className="text-content-muted" aria-hidden="true">·</span>
      <span>Deletes in 60 min</span>
    </div>
  );
}
