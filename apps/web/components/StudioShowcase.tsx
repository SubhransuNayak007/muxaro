'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Minimize2,
  Scissors,
  FileText,
  Volume2,
  ArrowUpRight,
} from 'lucide-react';
import { ALL_STUDIO_TOOLS } from '@/lib/tools-catalog';

type ShowcaseStage = 'compress' | 'trim' | 'pdf' | 'loudnorm';

const STAGES: {
  id: ShowcaseStage;
  shortLabel: string;
  title: string;
  subtitle: string;
  icon: typeof Minimize2;
  href: string;
}[] = [
  {
    id: 'compress',
    shortLabel: 'Compressor',
    title: 'Target Size Compressor',
    subtitle: 'Exact Discord 10 MB or WhatsApp 16 MB bitrate math',
    icon: Minimize2,
    href: '/tools/video-compressor?preset=discord-10mb',
  },
  {
    id: 'trim',
    shortLabel: 'Trimmer',
    title: 'Lossless Trimmer',
    subtitle: 'Browser stream-copy cuts and 60s Reels ZIP splits',
    icon: Scissors,
    href: '/tools/video-trimmer',
  },
  {
    id: 'pdf',
    shortLabel: 'PDF Engine',
    title: '3-Tier Browser PDF Suite',
    subtitle: 'QPDF lossless streams, SMask shrink, and Tesseract OCR',
    icon: FileText,
    href: '/tools/pdf/compress',
  },
  {
    id: 'loudnorm',
    shortLabel: 'Loudness',
    title: 'EBU R128 Audio Calibration',
    subtitle: 'True-peak loudness mastering for YouTube and podcasts',
    icon: Volume2,
    href: '/tools/audio-normalizer?lufs=-14',
  },
];

const COMPRESS_PRESETS = [
  { id: 'discord', label: '10 MB Discord', mb: 10, audioKbps: 96, href: '/tools/video-compressor?preset=discord-10mb' },
  { id: 'whatsapp', label: '16 MB WhatsApp', mb: 16, audioKbps: 128, href: '/tools/video-compressor?preset=whatsapp-16mb' },
  { id: 'slack', label: '25 MB Slack', mb: 25, audioKbps: 128, href: '/tools/video-compressor?preset=email-25mb' },
] as const;

const PDF_TIERS = [
  {
    id: 'lossless',
    label: 'Lossless QPDF',
    engine: 'qpdf-run WASM',
    pipeline: 'Object stream generation and flate recompression',
    textPreserved: '100% vector text intact',
    href: '/tools/pdf/compress',
  },
  {
    id: 'balanced',
    label: 'Balanced SMask',
    engine: 'pdf-lib + Canvas',
    pipeline: 'Alpha-aware image downsampling while keeping selectable fonts',
    textPreserved: 'Selectable text preserved',
    href: '/tools/pdf/compress',
  },
  {
    id: 'ocr',
    label: 'Searchable OCR',
    engine: 'Tesseract LSTM Pool',
    pipeline: 'Multi-worker OCR embedding invisible Tr=3 text layers',
    textPreserved: 'Searchable PDF + Markdown',
    href: '/tools/pdf/ocr',
  },
] as const;

const LUFS_PRESETS = [
  { id: 'yt', label: '-14 LUFS YouTube', peak: '-1.0 dBTP', bars: [78, 84, 82, 86, 80, 85, 83, 84], href: '/tools/audio-normalizer?lufs=-14' },
  { id: 'pod', label: '-16 LUFS Podcast', peak: '-1.5 dBTP', bars: [68, 72, 74, 70, 75, 73, 71, 74], href: '/tools/audio-normalizer?lufs=-16' },
  { id: 'tv', label: '-23 LUFS Broadcast', peak: '-1.0 dBTP', bars: [48, 52, 50, 54, 49, 53, 51, 52], href: '/tools/audio-normalizer?lufs=-23' },
] as const;

export default function StudioShowcase() {
  const [stage, setStage] = useState<ShowcaseStage>('compress');
  const [compId, setCompId] = useState<'discord' | 'whatsapp' | 'slack'>('discord');
  const [durationSec, setDurationSec] = useState<number>(38);
  const [trimRange, setTrimRange] = useState<'clip' | 'split60'>('clip');
  const [pdfTierId, setPdfTierId] = useState<'lossless' | 'balanced' | 'ocr'>('lossless');
  const [lufsId, setLufsId] = useState<'yt' | 'pod' | 'tv'>('yt');

  const compActive = COMPRESS_PRESETS.find((c) => c.id === compId) || COMPRESS_PRESETS[0];
  const pdfActive = PDF_TIERS.find((p) => p.id === pdfTierId) || PDF_TIERS[0];
  const lufsActive = LUFS_PRESETS.find((l) => l.id === lufsId) || LUFS_PRESETS[0];
  const activeStageMeta = STAGES.find((s) => s.id === stage) || STAGES[0];

  // Live 2-pass target bitrate math: (targetMB * 8192 * 0.96 headroom) / durationSec - audioKbps
  const totalKbps = Math.round((compActive.mb * 8192 * 0.96) / Math.max(5, durationSec));
  const computedVideoKbps = Math.max(180, totalKbps - compActive.audioKbps);
  const ringOffset = Math.max(12, Math.round(289 * (1 - Math.min(1, computedVideoKbps / 6500))));

  const ctaHref =
    stage === 'compress'
      ? compActive.href
      : stage === 'pdf'
      ? pdfActive.href
      : stage === 'loudnorm'
      ? lufsActive.href
      : activeStageMeta.href;

  return (
    <section
      className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-16 border-t border-line"
      aria-labelledby="workbench-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-7">
        <h2
          id="workbench-heading"
          className="text-3xl sm:text-4xl font-display font-medium text-content tracking-[-0.02em]"
        >
          Calibrate before you render
        </h2>
        <Link
          href="/tools"
          className="text-xs font-semibold text-brand hover:text-brand-hover inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded"
        >
          <span>Open all {ALL_STUDIO_TOOLS.length} tools</span>
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      {/* Mobile Tab Strip */}
      <div
        role="tablist"
        aria-label="Preview studio workflows"
        className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-3 mb-3"
      >
        {STAGES.map((item) => {
          const Icon = item.icon;
          const active = stage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStage(item.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                active
                  ? 'bg-brand/12 border-brand/35 text-brand font-semibold'
                  : 'bg-surface border-line text-content-secondary hover:text-content'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden={true} />
              <span>{item.shortLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Desktop Left Rail */}
        <div
          role="tablist"
          aria-label="Preview studio workflows"
          className="hidden lg:flex lg:col-span-4 flex-col gap-2"
        >
          {STAGES.map((item) => {
            const Icon = item.icon;
            const active = stage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStage(item.id)}
                className={`p-4 rounded-xl border text-left transition-colors flex items-start gap-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  active
                    ? 'bg-surface border-brand/45 text-content'
                    : 'bg-surface/40 border-line text-content-secondary hover:bg-surface hover:text-content'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                    active
                      ? 'bg-brand/12 border-brand/30 text-brand'
                      : 'bg-surface-elevated border-line text-content-secondary'
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden={true} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-content">{item.title}</div>
                  <div className="text-xs text-content-secondary mt-0.5">{item.subtitle}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Instrument Console */}
        <div className="lg:col-span-8 rounded-2xl border border-line bg-surface p-6 flex flex-col justify-between gap-6">
          {stage === 'compress' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-line bg-surface-elevated">
                  {COMPRESS_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setCompId(p.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                        compId === p.id
                          ? 'bg-brand text-white'
                          : 'text-content-secondary hover:text-content'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <span className="text-xs font-mono text-content-secondary tabular-nums">
                  2-pass H.264 + AAC
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center py-1">
                <div className="sm:col-span-4 flex flex-col items-center justify-center">
                  <svg viewBox="0 0 120 120" className="w-32 h-32" role="img" aria-label={`Target size ${compActive.mb} megabytes`}>
                    <circle cx="60" cy="60" r="46" fill="none" stroke="var(--muxaro-border)" strokeWidth="10" />
                    <circle
                      cx="60"
                      cy="60"
                      r="46"
                      fill="none"
                      stroke="var(--muxaro-accent)"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray="289"
                      strokeDashoffset={ringOffset}
                      transform="rotate(-90 60 60)"
                    />
                    <text x="60" y="57" textAnchor="middle" fill="var(--muxaro-text-primary)" fontSize="20" fontWeight="600">
                      {compActive.mb} MB
                    </text>
                    <text x="60" y="74" textAnchor="middle" fill="var(--muxaro-text-secondary)" fontSize="10">
                      max target
                    </text>
                  </svg>
                </div>

                <div className="sm:col-span-8 space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <label htmlFor="workbench-duration" className="text-content-secondary font-medium">
                        Clip duration
                      </label>
                      <span className="font-mono text-content font-semibold tabular-nums">{durationSec}s</span>
                    </div>
                    <input
                      id="workbench-duration"
                      type="range"
                      min={10}
                      max={180}
                      value={durationSec}
                      onChange={(e) => setDurationSec(Number(e.target.value))}
                      className="w-full accent-brand cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono tabular-nums">
                      <span className="text-content-secondary">Video stream budget</span>
                      <span className="text-content font-semibold">{computedVideoKbps} kbps</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-elevated overflow-hidden">
                      <div
                        className="h-full bg-brand origin-left transition-transform duration-200"
                        style={{ transform: `scaleX(${Math.min(1, computedVideoKbps / 6500)})` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono tabular-nums">
                      <span className="text-content-secondary">Audio track budget</span>
                      <span className="text-content font-semibold">{compActive.audioKbps} kbps AAC</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-elevated overflow-hidden">
                      <div
                        className="h-full bg-content/45 origin-left transition-transform duration-200"
                        style={{ transform: `scaleX(${compActive.audioKbps / 320})` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {stage === 'trim' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-line bg-surface-elevated">
                  <button
                    type="button"
                    onClick={() => setTrimRange('clip')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                      trimRange === 'clip'
                        ? 'bg-brand text-white'
                        : 'text-content-secondary hover:text-content'
                    }`}
                  >
                    Single range trim
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrimRange('split60')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                      trimRange === 'split60'
                        ? 'bg-brand text-white'
                        : 'text-content-secondary hover:text-content'
                    }`}
                  >
                    Split 60s parts ZIP
                  </button>
                </div>
                <span className="text-xs font-mono text-brand">Stream copy enabled</span>
              </div>

              <div className="py-4 space-y-3">
                <svg viewBox="0 0 560 110" className="w-full h-auto" role="img" aria-label="Video trim filmstrip timeline">
                  <rect x="2" y="14" width="556" height="68" rx="10" fill="var(--muxaro-bg-elevated)" stroke="var(--muxaro-border)" />
                  {[24, 96, 168, 240, 312, 384, 456].map((xPos, i) => (
                    <rect
                      key={xPos}
                      x={xPos}
                      y="24"
                      width="62"
                      height="48"
                      rx="5"
                      fill="var(--muxaro-bg-surface)"
                      opacity={i % 2 === 0 ? 0.9 : 0.65}
                    />
                  ))}
                  {trimRange === 'clip' ? (
                    <g>
                      <rect
                        x="128"
                        y="10"
                        width="274"
                        height="76"
                        rx="8"
                        fill="var(--muxaro-accent)"
                        fillOpacity="0.14"
                        stroke="var(--muxaro-accent)"
                        strokeWidth="2.5"
                      />
                      <rect x="122" y="8" width="10" height="80" rx="4" fill="var(--muxaro-accent)" />
                      <rect x="398" y="8" width="10" height="80" rx="4" fill="var(--muxaro-accent)" />
                      <text x="128" y="104" fill="var(--muxaro-text-primary)" fontSize="11" fontFamily="monospace">00:12.4</text>
                      <text x="366" y="104" fill="var(--muxaro-text-primary)" fontSize="11" fontFamily="monospace">01:00.0</text>
                    </g>
                  ) : (
                    <g>
                      {[16, 150, 284, 418].map((xSeg, idx) => (
                        <g key={xSeg}>
                          <rect
                            x={xSeg}
                            y="12"
                            width="126"
                            height="72"
                            rx="7"
                            fill="var(--muxaro-accent)"
                            fillOpacity="0.12"
                            stroke="var(--muxaro-accent)"
                            strokeWidth="2"
                          />
                          <text x={xSeg + 34} y="104" fill="var(--muxaro-text-primary)" fontSize="11" fontFamily="monospace">
                            Part {idx + 1} (60s)
                          </text>
                        </g>
                      ))}
                    </g>
                  )}
                </svg>
              </div>
            </>
          )}

          {stage === 'pdf' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-line bg-surface-elevated">
                  {PDF_TIERS.map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setPdfTierId(tier.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                        pdfTierId === tier.id
                          ? 'bg-brand text-white'
                          : 'text-content-secondary hover:text-content'
                      }`}
                    >
                      {tier.label}
                    </button>
                  ))}
                </div>
                <span className="text-xs font-mono text-success">0 bytes uploaded</span>
              </div>

              <dl className="divide-y divide-line border-y border-line my-2">
                <div className="py-3.5 flex items-center justify-between gap-4 text-xs">
                  <dt className="text-content-secondary">Local WASM engine</dt>
                  <dd className="font-mono font-medium text-content">{pdfActive.engine}</dd>
                </div>
                <div className="py-3.5 flex items-center justify-between gap-4 text-xs">
                  <dt className="text-content-secondary">Processing pipeline</dt>
                  <dd className="text-content font-medium text-right">{pdfActive.pipeline}</dd>
                </div>
                <div className="py-3.5 flex items-center justify-between gap-4 text-xs">
                  <dt className="text-content-secondary">Output fidelity</dt>
                  <dd className="font-mono font-medium text-brand">{pdfActive.textPreserved}</dd>
                </div>
              </dl>
            </>
          )}

          {stage === 'loudnorm' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-line bg-surface-elevated">
                  {LUFS_PRESETS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLufsId(l.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                        lufsId === l.id
                          ? 'bg-brand text-white'
                          : 'text-content-secondary hover:text-content'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <span className="text-xs font-mono text-content-secondary tabular-nums">{lufsActive.peak} ceiling</span>
              </div>

              <div className="py-3">
                <svg viewBox="0 0 560 120" className="w-full h-auto" role="img" aria-label={`Audio loudness curve for ${lufsActive.label}`}>
                  <line x1="20" y1="30" x2="540" y2="30" stroke="var(--muxaro-accent)" strokeDasharray="5 5" strokeWidth="1.5" />
                  <text x="540" y="22" textAnchor="end" fill="var(--muxaro-accent)" fontSize="11" fontFamily="monospace">
                    {lufsActive.label}
                  </text>
                  {lufsActive.bars.map((val, idx) => {
                    const barH = Math.round((val / 100) * 76);
                    const yPos = 108 - barH;
                    const xPos = 34 + idx * 62;
                    return (
                      <g key={idx}>
                        <rect x={xPos} y="32" width="38" height="76" rx="6" fill="var(--muxaro-bg-elevated)" />
                        <rect x={xPos} y={yPos} width="38" height={barH} rx="6" fill="var(--muxaro-accent)" />
                      </g>
                    );
                  })}
                </svg>
              </div>
            </>
          )}

          <div className="pt-4 border-t border-line-subtle flex items-center justify-between gap-3">
            <span className="text-xs text-content-secondary">
              {stage === 'trim' || stage === 'pdf'
                ? 'Runs locally in your browser with zero server upload.'
                : 'Supports local files up to 2 GB and remote links.'}
            </span>
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white hover:bg-brand-hover text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus shrink-0"
            >
              <span>Open {activeStageMeta.title}</span>
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
