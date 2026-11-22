/* Hallmark · theme: MUXARO Luxury Media Studio Dock · surface: obsidian / alabaster · posture: committed · typography: editorial-tabular · contrast: high */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Studio Dock — MUXARO',
  description:
    'The MUXARO Studio Dock — your command center for Media Conversion, Lossless Audio Extraction, Video/Audio Muxing, Playlist Batch Processing, Bitrate Calculation, and Codec Inspection.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://muxaro.app/dock' },
};

/* ─── Tool definitions ────────────────────────────────────────────────────── */
interface StudioTool {
  id: string;
  label: string;
  caption: string;
  href: string;
  shortcut: string;
  mark: string; /* monochrome SVG path data or simple glyph */
}

const STUDIO_TOOLS: StudioTool[] = [
  {
    id: 'media-converter',
    label: 'Media Converter',
    caption: 'Transcode and remux between MP4, MKV, WebM, MOV, and more with lossless stream-copy.',
    href: '/tools/media-converter',
    shortcut: 'M',
    mark: 'M',
  },
  {
    id: 'audio-extractor',
    label: 'Lossless Audio Extractor',
    caption: 'Extract pristine audio tracks as FLAC, WAV, MP3, AAC, or Opus without re-encoding.',
    href: '/tools/audio-extractor',
    shortcut: 'A',
    mark: 'A',
  },
  {
    id: 'muxer',
    label: 'Video / Audio Muxer',
    caption: 'Merge disjoint video and audio streams with millisecond offset synchronisation.',
    href: '/tools/audio-video-merger',
    shortcut: 'X',
    mark: 'X',
  },
  {
    id: 'playlist',
    label: 'Playlist Batch Engine',
    caption: 'Queue and process entire playlists or file batches with parallel worker dispatch.',
    href: '/tools/playlist-processing',
    shortcut: 'P',
    mark: 'P',
  },
  {
    id: 'bitrate-calc',
    label: 'Bitrate Calculator',
    caption: 'Compute target bitrates for any resolution, codec, and desired file size envelope.',
    href: '/tools/batch-processing',
    shortcut: 'B',
    mark: 'B',
  },
  {
    id: 'codec-inspector',
    label: 'Codec Inspector',
    caption: 'Probe container streams via ffprobe to surface codec, bitrate, and channel metadata.',
    href: '/tools/direct-helper',
    shortcut: 'C',
    mark: 'C',
  },
];

/* ─── Static specification tables ────────────────────────────────────────── */
const CONTAINER_FORMATS = [
  { ext: '.mp4', codec: 'H.264 / H.265 / AV1', note: 'Universal delivery' },
  { ext: '.mkv', codec: 'Any codec passthrough', note: 'Lossless archive' },
  { ext: '.webm', codec: 'VP9 / AV1 / Opus', note: 'Open web standard' },
  { ext: '.mov', codec: 'ProRes / DNxHD', note: 'Professional edit' },
];

const AUDIO_FORMATS = [
  { ext: '.mp3',  bitrate: 'up to 320 kbps',  note: 'Universal portable' },
  { ext: '.flac', bitrate: '24-bit / 48 kHz',  note: 'Studio lossless' },
  { ext: '.wav',  bitrate: 'PCM uncompressed', note: 'Broadcast master' },
  { ext: '.aac',  bitrate: 'up to 256 kbps',   note: 'Mobile optimised' },
  { ext: '.opus', bitrate: 'up to 510 kbps',   note: 'Low-latency stream' },
];

const RESOLUTION_MATRIX = [
  { label: '8K UHD',    px: '7680 × 4320', fps: '30',   note: 'Lossless remux only' },
  { label: '4K UHD',    px: '3840 × 2160', fps: '60',   note: 'AV1 / H.265 / VP9' },
  { label: '1080p 60',  px: '1920 × 1080', fps: '60',   note: 'H.264 / H.265' },
  { label: '720p',      px: '1280 × 720',  fps: '30/60', note: 'Universal compat' },
];

const SHORTCUTS = [
  { keys: ['⌘ K', 'Ctrl K'], action: 'Open command search' },
  { keys: ['Esc'],            action: 'Clear / dismiss' },
  { keys: ['Space'],          action: 'Preview selected' },
  { keys: ['Enter'],          action: 'Start processing' },
];

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function DockPage() {
  return (
    <>
      <style>{`
        /* Hallmark: token block — no literal colour past this point */
        .dock-page {
          --dk-bg:           var(--muxaro-bg-base);
          --dk-surface:      var(--muxaro-bg-surface);
          --dk-elevated:     var(--muxaro-bg-elevated);
          --dk-border:       var(--muxaro-border);
          --dk-border-hover: var(--muxaro-border-hover);
          --dk-text-1:       var(--muxaro-text-primary);
          --dk-text-2:       var(--muxaro-text-secondary);
          --dk-text-3:       var(--muxaro-text-tertiary);
          --dk-accent:       var(--muxaro-accent);
          --dk-shadow-card:  var(--muxaro-shadow-card);
          --dk-radius-md:    var(--muxaro-radius-md);
          --dk-radius-lg:    var(--muxaro-radius-lg);
          /* tabular numeric stack */
          font-variant-numeric: tabular-nums;
        }

        /* Tool cards */
        .dock-tool-card {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1.5rem;
          background: var(--dk-surface);
          border: 1px solid var(--dk-border);
          border-radius: var(--dk-radius-lg);
          box-shadow: var(--dk-shadow-card);
          text-decoration: none;
          color: inherit;
          transition: border-color 150ms ease, box-shadow 150ms ease;
          position: relative;
          overflow: hidden;
        }
        .dock-tool-card:hover {
          border-color: var(--dk-border-hover);
          box-shadow: var(--muxaro-shadow-lg);
        }
        .dock-tool-card:focus-visible {
          outline: 2px solid var(--dk-accent);
          outline-offset: 2px;
        }

        /* Shortcut badge on card */
        .dock-tool-shortcut {
          position: absolute;
          top: 1rem;
          right: 1rem;
          font-size: 0.6875rem;
          font-weight: 700;
          font-family: ui-monospace, 'Cascadia Code', monospace;
          line-height: 1;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          background: var(--dk-elevated);
          border: 1px solid var(--dk-border);
          color: var(--dk-text-3);
          letter-spacing: 0;
        }

        /* Mark glyph */
        .dock-tool-mark {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 8px;
          background: var(--muxaro-tag-pill-bg);
          border: 1px solid var(--dk-border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.875rem;
          font-weight: 800;
          font-family: ui-monospace, 'Cascadia Code', monospace;
          color: var(--dk-text-1);
          flex-shrink: 0;
        }

        /* Spec table */
        .dock-spec-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8125rem;
        }
        .dock-spec-table th {
          text-align: left;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--dk-text-3);
          padding: 0.5rem 1rem;
          border-bottom: 1px solid var(--dk-border);
        }
        .dock-spec-table td {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--muxaro-border-subtle);
          color: var(--dk-text-1);
          vertical-align: middle;
        }
        .dock-spec-table tr:last-child td {
          border-bottom: none;
        }
        .dock-spec-table .ext {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-weight: 700;
          font-size: 0.8125rem;
          color: var(--dk-text-1);
        }
        .dock-spec-table .note {
          color: var(--dk-text-3);
          font-size: 0.75rem;
        }

        /* Shortcut chips */
        .dock-kbd {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 0.6875rem;
          font-weight: 700;
          padding: 0.1875rem 0.4375rem;
          border-radius: 4px;
          background: var(--dk-elevated);
          border: 1px solid var(--dk-border);
          color: var(--dk-text-2);
          white-space: nowrap;
        }

        /* Section header rule */
        .dock-section-label {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--dk-text-3);
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1.25rem;
        }
        .dock-section-label::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--dk-border);
        }

        /* Reduced-motion safety */
        @media (prefers-reduced-motion: reduce) {
          .dock-tool-card { transition: none; }
        }
      `}</style>

      <div className="dock-page w-full max-w-6xl mx-auto py-12 px-4 sm:px-6 space-y-14">

        {/* ── Page header ── */}
        <header className="space-y-3 border-b border-[var(--dk-border)] pb-10">
          <div className="flex items-center gap-3">
            <span
              className="w-10 h-10 rounded-xl bg-[var(--muxaro-tag-pill-bg)] border border-[var(--dk-border)] flex items-center justify-center"
              aria-hidden="true"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="11" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="1" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="11" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--dk-text-1)]">
              Studio Dock
            </h1>
          </div>
          <p className="text-sm text-[var(--dk-text-2)] max-w-xl leading-relaxed">
            Your command center for precision media work. Six professional-grade tools,
            lossless pipelines, and zero ads — built on ffmpeg.
          </p>
          <p className="text-xs text-[var(--dk-text-3)] font-mono">
            Press <span className="dock-kbd">⌘ K</span> or <span className="dock-kbd">Ctrl K</span> to search tools
          </p>
        </header>

        {/* ── Core Studio Tools Grid ── */}
        <section aria-labelledby="tools-heading">
          <div className="dock-section-label" id="tools-heading" role="heading" aria-level={2}>
            Core Studio Tools
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {STUDIO_TOOLS.map((tool) => (
              <Link
                key={tool.id}
                href={tool.href}
                className="dock-tool-card"
                aria-label={`${tool.label} — ${tool.caption}`}
              >
                <span className="dock-tool-shortcut" aria-hidden="true">{tool.shortcut}</span>
                <div className="dock-tool-mark" aria-hidden="true">{tool.mark}</div>
                <div className="space-y-1 pr-10">
                  <div className="text-sm font-bold text-[var(--dk-text-1)] leading-snug">
                    {tool.label}
                  </div>
                  <div className="text-xs text-[var(--dk-text-2)] leading-relaxed">
                    {tool.caption}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Studio Specifications ── */}
        <section aria-labelledby="specs-heading">
          <div className="dock-section-label" id="specs-heading" role="heading" aria-level={2}>
            Studio Specifications
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Container formats */}
            <div
              className="rounded-xl border border-[var(--dk-border)] overflow-hidden bg-[var(--dk-surface)] shadow-[var(--dk-shadow-card)]"
              aria-label="Supported container formats"
            >
              <div className="px-4 py-3 border-b border-[var(--dk-border)] bg-[var(--dk-elevated)]">
                <span className="text-xs font-bold text-[var(--dk-text-2)] uppercase tracking-wider">
                  Container Formats
                </span>
              </div>
              <table className="dock-spec-table">
                <thead>
                  <tr>
                    <th>Ext</th>
                    <th>Codec Support</th>
                    <th className="hidden sm:table-cell">Use</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTAINER_FORMATS.map((f) => (
                    <tr key={f.ext}>
                      <td><span className="ext">{f.ext}</span></td>
                      <td className="text-xs text-[var(--dk-text-2)]">{f.codec}</td>
                      <td className="hidden sm:table-cell note">{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Audio formats */}
            <div
              className="rounded-xl border border-[var(--dk-border)] overflow-hidden bg-[var(--dk-surface)] shadow-[var(--dk-shadow-card)]"
              aria-label="Supported audio formats"
            >
              <div className="px-4 py-3 border-b border-[var(--dk-border)] bg-[var(--dk-elevated)]">
                <span className="text-xs font-bold text-[var(--dk-text-2)] uppercase tracking-wider">
                  Audio Formats
                </span>
              </div>
              <table className="dock-spec-table">
                <thead>
                  <tr>
                    <th>Ext</th>
                    <th>Quality</th>
                    <th className="hidden sm:table-cell">Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {AUDIO_FORMATS.map((f) => (
                    <tr key={f.ext}>
                      <td><span className="ext">{f.ext}</span></td>
                      <td className="text-xs text-[var(--dk-text-2)] font-mono">{f.bitrate}</td>
                      <td className="hidden sm:table-cell note">{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Resolution matrix */}
            <div
              className="rounded-xl border border-[var(--dk-border)] overflow-hidden bg-[var(--dk-surface)] shadow-[var(--dk-shadow-card)]"
              aria-label="Supported resolution matrix"
            >
              <div className="px-4 py-3 border-b border-[var(--dk-border)] bg-[var(--dk-elevated)]">
                <span className="text-xs font-bold text-[var(--dk-text-2)] uppercase tracking-wider">
                  Resolution Matrix
                </span>
              </div>
              <table className="dock-spec-table">
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th>Pixels</th>
                    <th>fps</th>
                  </tr>
                </thead>
                <tbody>
                  {RESOLUTION_MATRIX.map((r) => (
                    <tr key={r.label}>
                      <td className="font-bold text-xs">{r.label}</td>
                      <td className="font-mono text-xs text-[var(--dk-text-2)]">{r.px}</td>
                      <td className="font-mono text-xs text-[var(--dk-text-3)]">{r.fps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </section>

        {/* ── Studio Shortcuts ── */}
        <section aria-labelledby="shortcuts-heading">
          <div className="dock-section-label" id="shortcuts-heading" role="heading" aria-level={2}>
            Studio Shortcuts
          </div>
          <div
            className="rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface)] shadow-[var(--dk-shadow-card)] divide-y divide-[var(--muxaro-border-subtle)] overflow-hidden"
            role="list"
            aria-label="Keyboard shortcuts"
          >
            {SHORTCUTS.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-5 py-3.5"
                role="listitem"
              >
                <span className="text-sm text-[var(--dk-text-2)]">{s.action}</span>
                <span className="flex items-center gap-1.5" aria-label={s.keys.join(' or ')}>
                  {s.keys.map((k) => (
                    <kbd key={k} className="dock-kbd">{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Footer note ── */}
        <footer className="border-t border-[var(--dk-border)] pt-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-xs text-[var(--dk-text-3)]">
            All processing is ephemeral — files purged automatically within 60 minutes.
            Zero cookies, zero ads, zero re-encoding unless requested.
          </p>
          <Link
            href="/docs"
            className="text-xs font-semibold text-[var(--dk-text-2)] hover:text-[var(--dk-text-1)] transition-colors duration-100 underline underline-offset-2"
          >
            Documentation
          </Link>
        </footer>

      </div>
    </>
  );
}
