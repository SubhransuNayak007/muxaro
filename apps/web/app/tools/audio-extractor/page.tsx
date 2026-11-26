'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ExtractAudioTool } from '@/components/tools/extract-audio-tool';

export default function AudioExtractorPage() {
  return (
    <div className="w-full">
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link
            href="/tools"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>All media tools</span>
          </Link>
        </div>
      </section>

      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <ExtractAudioTool />
      </div>
    </div>
  );
}
