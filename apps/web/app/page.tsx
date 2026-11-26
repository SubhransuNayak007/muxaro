import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import HomeWorkspace from '@/components/HomeWorkspace';
import StudioShowcase from '@/components/StudioShowcase';
import SuiteIndexLedger from '@/components/SuiteIndexLedger';
import HomeToolsDirectory from '@/components/HomeToolsDirectory';
import AudioRoadmapBand from '@/components/AudioRoadmapBand';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
  buildFaqJsonLd,
} from '@/lib/seo';
import { ALL_STUDIO_TOOLS, CREATOR_TOOLS_CATALOG, PDF_TOOLS_CATALOG } from '@/lib/tools-catalog';

export const metadata: Metadata = constructMetadata({
  title: 'MUXARO — All-in-One Video, PDF & Media Studio',
  description:
    'Process video up to 8K, compress to exact Discord 10 MB or WhatsApp 16 MB targets, edit and OCR 38 PDF workflows locally in your browser, and extract lossless audio.',
  path: '/',
  keywords: [
    'all in one video tools',
    'private browser pdf tools',
    'video downloader 8k',
    'discord 10mb video compressor',
    'lossless video trimmer browser',
    'audio loudness normalizer -14 lufs',
    'ocr searchable pdf',
    'media converter 105 formats',
  ],
});

const HOME_STEPS = [
  {
    name: 'Paste a URL or drop any file',
    text: 'Enter any supported video link up to 8K or drop MP4, MKV, MP3, PDF, DOCX, or PPTX files.',
  },
  {
    name: 'Run locally in your browser',
    text: 'All 38 PDF tools and Tier-1 video/audio utilities execute directly in WebAssembly with zero server upload.',
  },
  {
    name: 'Chain outputs cleanly',
    text: 'Pass finished artifacts directly into compression, trimming, OCR, signing, or encryption without re-uploading.',
  },
];

const HOME_FAQS = [
  {
    question: 'Which tools run 100% locally in my browser?',
    answer:
      'All 38 PDF Studio tools (merge, split, compress, edit, sign, OCR, PKCS#7 verify, AES-256 protect) and Tier-1 video/audio tools (lossless trimmer, frame grabber, subtitle shifter, metadata scrubber, and remuxer) run inside your browser with zero server uploads.',
  },
  {
    question: 'Are there any daily credits, paywalls, or ads?',
    answer:
      'No. Credits have been removed completely. Browser-local tools run without limits, and Cloud FFmpeg worker tasks run with zero display ads or sign-in walls.',
  },
  {
    question: 'How long are temporary Cloud worker files kept?',
    answer:
      'Media processed by Cloud FFmpeg workers stays isolated only long enough for downloads and zero-reupload chaining, then is automatically deleted within 60 minutes.',
  },
  {
    question: 'What is coming in the Audio Studio suite?',
    answer:
      'The upcoming Audio Studio expands MUXARO beyond Audio Extractor and Loudness Normalizer with local stem separation, voice de-noise, waveform silence trimming, and podcast mastering.',
  },
];

export default function HomePage() {
  const webAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO All-in-One Media & PDF Studio',
    description:
      '52 integrated browser-local and Cloud FFmpeg tools across Video Studio, PDF Studio, Stream Downloader, and Audio workflows.',
    path: '/',
    features: [
      '8K and 4K stream downloading with video, audio, and compact modes',
      '14 Video & Audio Studio tools including 10 MB compression, lossless trim, and 9:16 smart pad',
      '38 browser-local PDF tools including QPDF compression, OCR, signing, and PKCS#7 verification',
      'Zero credits, zero sign-up, and zero third-party ads',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to Process Video, Audio, and PDFs with MUXARO',
    description: 'Paste a link or drop any supported file, pick a workflow, and save your output.',
    path: '/',
    steps: HOME_STEPS,
  });

  const faqJsonLd = buildFaqJsonLd(HOME_FAQS, {
    path: '/',
    name: 'MUXARO Frequently Asked Questions',
  });

  return (
    <div className="w-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Fold-Locked Clean Liquid-Glass Hero */}
      <section className="w-full pt-10 pb-12 sm:pt-14 sm:pb-16">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-7">
            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-display font-medium text-content tracking-[-0.025em] leading-[1.06] mb-3 break-words">
              Every media and PDF tool.
            </h1>
            <p className="text-sm sm:text-base text-content-secondary leading-relaxed">
              Grab 8K streams, trim or compress video, and run {PDF_TOOLS_CATALOG.length} local PDF tools in your browser.
            </p>
          </div>

          <HomeWorkspace />

          {/* Clean Suite Strip */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
            <Link
              href="/tools?section=video"
              className="liquid-glass spring-bounce px-3.5 py-1.5 rounded-full text-content font-medium"
            >
              Video ({CREATOR_TOOLS_CATALOG.length})
            </Link>
            <Link
              href="/tools/pdf"
              className="liquid-glass spring-bounce px-3.5 py-1.5 rounded-full text-content font-medium"
            >
              PDF ({PDF_TOOLS_CATALOG.length})
            </Link>
            <Link
              href="/tools?section=audio"
              className="liquid-glass spring-bounce px-3.5 py-1.5 rounded-full text-content-secondary hover:text-content font-medium"
            >
              Audio (Next)
            </Link>
            <Link
              href="/tools"
              className="spring-bounce px-3.5 py-1.5 rounded-full border border-brand/30 bg-brand/10 text-brand font-semibold hover:bg-brand/15"
            >
              All {ALL_STUDIO_TOOLS.length} tools
            </Link>
          </div>
        </div>
      </section>

      {/* Interactive Workbench Console */}
      <StudioShowcase />

      {/* Four-Suite Architectural Ledger */}
      <SuiteIndexLedger />

      {/* Searchable Launcher Directory + Local vs Cloud Spec Table */}
      <HomeToolsDirectory />

      {/* Upcoming Audio Suite Preview Band */}
      <AudioRoadmapBand />

      {/* Concise Factual FAQ */}
      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-16 border-t border-line">
        <h2 className="text-3xl sm:text-4xl font-display font-medium text-content tracking-[-0.02em] mb-8">
          Questions
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
          {HOME_FAQS.map((item) => (
            <div key={item.question} className="pb-5 border-b border-line-subtle">
              <dt className="text-sm font-semibold text-content">{item.question}</dt>
              <dd className="text-xs sm:text-sm text-content-secondary leading-relaxed mt-1.5">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
