import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import HomeWorkspace from '@/components/HomeWorkspace';
import SuiteIndexLedger from '@/components/SuiteIndexLedger';
import {
  constructMetadata,
  buildToolSoftwareAppJsonLd,
  buildHowToJsonLd,
  buildFaqJsonLd,
} from '@/lib/seo';
import { ALL_STUDIO_TOOLS, CREATOR_TOOLS_CATALOG, PDF_TOOLS_CATALOG } from '@/lib/tools-catalog';

export const metadata: Metadata = constructMetadata({
  title: 'MUXARO — Media, PDF & Local AI Studio',
  description:
    'Process video up to 8K, edit 38 PDF workflows locally in your browser, and run an autonomous AI assistant with Python code execution and WebGPU privacy.',
  path: '/',
  keywords: [
    'all in one video tools',
    'private browser pdf tools',
    'local ai assistant webgpu',
    'video downloader 8k',
    'discord 10mb video compressor',
    'lossless video trimmer browser',
    'ocr searchable pdf',
  ],
});

const QUICK_LAUNCHERS = [
  { href: '/ai', title: 'AI Assistant', note: 'Chat, Python, Web Research' },
  { href: '/tools/video-compressor', title: 'Compress Video', note: '10 MB & 16 MB presets' },
  { href: '/tools/video-trimmer', title: 'Trim Video', note: 'Instant stream-copy cuts' },
  { href: '/tools/pdf/merge', title: 'Merge PDF', note: 'Zero-upload combine' },
  { href: '/tools/pdf/compress', title: 'Compress PDF', note: 'Lossless QPDF shrink' },
  { href: '/tools/pdf/ocr', title: 'OCR PDF', note: 'Searchable local text' },
] as const;

const HOME_STEPS = [
  {
    name: 'Paste a URL, question, or file',
    text: 'Enter a media link up to 8K, ask MUXARO AI, or drop MP4, MP3, PDF, or DOCX files.',
  },
  {
    name: 'Run locally in your browser',
    text: 'All 38 PDF tools, Pyodide Python analysis, and local WebGPU inference stay private in your browser.',
  },
  {
    name: 'Save or continue cleanly',
    text: 'Download results directly or pass outputs into the AI Studio or another tool.',
  },
];

const HOME_FAQS = [
  {
    question: 'Which tools run 100% locally in my browser?',
    answer:
      'All 38 PDF Studio tools, Pyodide Python analysis, local WebGPU inference, and Tier-1 video/audio utilities execute in-browser with zero file uploads.',
  },
  {
    question: 'How does MUXARO AI work on the website?',
    answer:
      'MUXARO AI supports local browser WebGPU models, Pyodide code execution, your own API keys (Gemini, OpenAI, Anthropic, OpenRouter, Groq), or Desktop Ollama.',
  },
];

export default function HomePage() {
  const webAppJsonLd = buildToolSoftwareAppJsonLd({
    name: 'MUXARO Media, PDF & Local AI Studio',
    description:
      '52 browser-local PDF and media tools paired with an autonomous ReAct AI assistant and 8K stream downloader.',
    path: '/',
    features: [
      'Autonomous AI Studio with ReAct tool loops, Pyodide sandbox, and WebGPU privacy',
      '8K and 4K stream downloading with video, audio, and compact presets',
      '14 Video & Audio Studio tools and 38 browser-local PDF utilities',
    ],
  });

  const howToJsonLd = buildHowToJsonLd({
    name: 'How to use MUXARO',
    description: 'Paste a link, drop a file, or ask AI in one calm workspace.',
    path: '/',
    steps: HOME_STEPS,
  });

  const faqJsonLd = buildFaqJsonLd(HOME_FAQS, {
    path: '/',
    name: 'MUXARO Questions',
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

      {/* Minimal Above-the-Fold Hero */}
      <section className="w-full pt-12 pb-14 sm:pt-20 sm:pb-20">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-xl mx-auto mb-8">
            <h1 className="text-4xl sm:text-5xl font-display font-medium text-content tracking-[-0.025em] leading-[1.08] mb-3 break-words">
              Media, PDFs, and local AI.
            </h1>
            <p className="text-sm sm:text-base text-content-secondary leading-relaxed">
              Save 8K video, edit PDFs privately, or ask AI directly.
            </p>
          </div>

          <HomeWorkspace />

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
            <Link
              href="/ai"
              className="px-3.5 py-1.5 rounded-full border border-brand/30 bg-brand/10 text-brand font-semibold hover:bg-brand/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              AI Studio
            </Link>
            <Link
              href="/tools?section=video"
              className="px-3.5 py-1.5 rounded-full border border-line bg-surface text-content font-medium hover:border-line-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Video ({CREATOR_TOOLS_CATALOG.length})
            </Link>
            <Link
              href="/tools/pdf"
              className="px-3.5 py-1.5 rounded-full border border-line bg-surface text-content font-medium hover:border-line-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              PDF ({PDF_TOOLS_CATALOG.length})
            </Link>
            <Link
              href="/tools"
              className="px-3.5 py-1.5 rounded-full border border-line bg-surface text-content-secondary hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              All {ALL_STUDIO_TOOLS.length} tools
            </Link>
          </div>
        </div>
      </section>

      {/* Clean 3-Row Suite Overview */}
      <SuiteIndexLedger />

      {/* Minimal 6-Tile Quick Launcher */}
      <section
        className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-line"
        aria-labelledby="quick-tools-heading"
      >
        <div className="flex items-baseline justify-between gap-4 mb-6">
          <h2
            id="quick-tools-heading"
            className="text-2xl sm:text-3xl font-display font-medium text-content tracking-[-0.02em]"
          >
            Quick tools
          </h2>
          <Link
            href="/tools"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded"
          >
            <span>All {ALL_STUDIO_TOOLS.length} tools</span>
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {QUICK_LAUNCHERS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="p-4 rounded-xl border border-line bg-surface hover:border-line-hover transition-colors flex items-center justify-between gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-content group-hover:text-brand truncate">
                  {item.title}
                </div>
                <div className="text-xs text-content-secondary truncate mt-0.5">
                  {item.note}
                </div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-content-tertiary group-hover:text-brand shrink-0" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
