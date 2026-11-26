'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Link2,
  ClipboardPaste,
  Download,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Search,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { getApiBaseUrl } from '@/lib/api-client';
import { normalizeMediaUrl } from '@/lib/url-utils';

interface TrackInfo {
  lang: string;
  name: string;
  isAuto: boolean;
}

interface InspectResponse {
  title: string;
  uploader?: string | null;
  durationSeconds?: number;
  thumbnailUrl?: string | null;
  manualTracks: TrackInfo[];
  autoTracks: TrackInfo[];
}

interface CueItem {
  index: number;
  startMs: number;
  endMs: number;
  startTime: string;
  text: string;
}

interface ExtractedTranscript {
  lang: string;
  isAuto: boolean;
  cues: CueItem[];
  plainText: string;
  cleanText?: string;
  srt: string;
  vtt: string;
}

export default function TranscriptExtractorPage() {
  const [urlInput, setUrlInput] = useState<string>('');
  const [inspecting, setInspecting] = useState<boolean>(false);
  const [extracting, setExtracting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trackData, setTrackData] = useState<InspectResponse | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<TrackInfo | null>(null);
  const [transcript, setTranscript] = useState<ExtractedTranscript | null>(null);
  const [showTimestamps, setShowTimestamps] = useState<boolean>(false);
  const [cleanAiMode, setCleanAiMode] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text?.trim()) setUrlInput(text.trim());
    } catch {}
  };

  const fetchTranscriptForTrack = async (url: string, track: TrackInfo) => {
    setExtracting(true);
    setErrorMessage(null);
    try {
      const base = getApiBaseUrl().replace(/\/+$/, '');
      const res = await fetch(`${base}/tools/transcripts/extract`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url, lang: track.lang, isAuto: track.isAuto }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success || !json?.data) {
        throw new Error(json?.error?.message || 'Could not extract transcript.');
      }
      setTranscript(json.data);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Transcript extraction failed.');
    } finally {
      setExtracting(false);
    }
  };

  const handleInspect = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setTranscript(null);
    const normalized = normalizeMediaUrl(urlInput);
    if (!normalized) {
      setErrorMessage('Please enter a valid video URL.');
      return;
    }

    setInspecting(true);
    try {
      const base = getApiBaseUrl().replace(/\/+$/, '');
      const res = await fetch(`${base}/tools/transcripts/inspect`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success || !json?.data) {
        throw new Error(json?.error?.message || 'Failed to inspect video subtitles.');
      }
      const data: InspectResponse = json.data;
      setTrackData(data);

      const defaultTrack = data.manualTracks[0] || data.autoTracks[0] || null;
      setSelectedTrack(defaultTrack);
      if (defaultTrack) {
        await fetchTranscriptForTrack(normalized, defaultTrack);
      } else {
        setErrorMessage('No subtitles or auto-generated captions were found for this video.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not inspect subtitles.');
    } finally {
      setInspecting(false);
    }
  };

  const filteredCues = useMemo(() => {
    if (!transcript) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return transcript.cues;
    return transcript.cues.filter((c) => c.text.toLowerCase().includes(q));
  }, [transcript, searchQuery]);

  const copyContent = async () => {
    if (!transcript) return;
    const cleanOut =
      transcript.cleanText ||
      transcript.plainText.replace(/\[(?:Music|Applause|Laughter|Inaudible|Sound)\]/gi, '').replace(/\s+/g, ' ').trim();
    const text = showTimestamps
      ? filteredCues.map((c) => `[${c.startTime}] ${c.text}`).join('\n')
      : cleanAiMode
      ? cleanOut
      : transcript.plainText;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const downloadFile = (ext: 'txt' | 'srt' | 'vtt' | 'md') => {
    if (!transcript) return;
    const stem = (trackData?.title || 'transcript')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 60);
    let content = transcript.plainText;
    if (ext === 'srt') content = transcript.srt;
    else if (ext === 'vtt') content = transcript.vtt;
    else if (ext === 'md') {
      content = `# ${trackData?.title || 'Transcript'}\n\n${transcript.cues
        .map((c) => `- **${c.startTime}** ${c.text}`)
        .join('\n')}`;
    } else if (showTimestamps) {
      content = transcript.cues.map((c) => `[${c.startTime}] ${c.text}`).join('\n');
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stem}_${transcript.lang}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const allTracks = useMemo(() => {
    if (!trackData) return [];
    return [...trackData.manualTracks, ...trackData.autoTracks];
  }, [trackData]);

  return (
    <div className="w-full">
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="mb-5">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>All media tools</span>
            </Link>
          </div>

          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-line text-xs font-medium text-content-secondary mb-3">
              <FileText className="w-3.5 h-3.5 text-content" aria-hidden="true" />
              <span>TXT · SRT · VTT · Markdown</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Transcript &amp; subtitle extractor
            </h1>
            <p className="text-base text-content-secondary mt-2.5 leading-relaxed">
              Extract clean, deduplicated transcripts and multi-language subtitles from any supported video without downloading the full video file.
            </p>
          </div>
        </div>
      </section>

      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6">
        <form
          onSubmit={handleInspect}
          className="muxaro-media-card p-5 sm:p-6 space-y-4 max-w-4xl mx-auto"
        >
          <label
            htmlFor="transcript-url"
            className="block text-xs font-semibold text-content-secondary"
          >
            Video URL
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 text-content-secondary absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="transcript-url"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="muxaro-input w-full pl-10 pr-4 py-3 text-sm"
                required
              />
            </div>
            <button
              type="button"
              onClick={handlePaste}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-line bg-surface-elevated text-xs font-semibold text-content hover:border-line-hover transition-colors"
            >
              <ClipboardPaste className="w-4 h-4 text-content-secondary" />
              <span>Paste</span>
            </button>
            <button
              type="submit"
              disabled={inspecting || !urlInput.trim()}
              className="muxaro-btn-primary px-6 py-3 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {inspecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Scanning…</span>
                </>
              ) : (
                <>
                  <span>Get Transcript</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-error-bg border border-error/20 text-error text-xs flex items-center gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </form>

        {trackData && (
          <div className="max-w-4xl mx-auto space-y-5">
            <div className="muxaro-card p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-bold text-content truncate">
                    {trackData.title}
                  </h2>
                  <p className="text-xs text-content-secondary mt-0.5">
                    {trackData.uploader || 'Video'} · {allTracks.length} subtitle tracks available
                  </p>
                </div>

                {allTracks.length > 0 && (
                  <select
                    aria-label="Subtitle language track"
                    value={selectedTrack ? `${selectedTrack.lang}:${selectedTrack.isAuto}` : ''}
                    onChange={(e) => {
                      const [lang, autoStr] = e.target.value.split(':');
                      const found = allTracks.find(
                        (t) => t.lang === lang && String(t.isAuto) === autoStr
                      );
                      if (found) {
                        setSelectedTrack(found);
                        void fetchTranscriptForTrack(normalizeMediaUrl(urlInput) || urlInput, found);
                      }
                    }}
                    className="px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content"
                  >
                    {allTracks.map((t) => (
                      <option key={`${t.lang}:${t.isAuto}`} value={`${t.lang}:${t.isAuto}`}>
                        {t.name} ({t.lang}) {t.isAuto ? '· Auto-generated' : '· Official'}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {extracting && (
                <div className="py-10 flex items-center justify-center gap-2 text-sm text-content-secondary">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Extracting &amp; cleaning transcript cues…</span>
                </div>
              )}

              {transcript && !extracting && (
                <div className="space-y-4">
                  {/* Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line">
                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                      <div className="relative flex-1 max-w-xs">
                        <Search className="w-3.5 h-3.5 text-content-secondary absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search transcript…"
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-line bg-base text-xs text-content"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTimestamps((p) => !p)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          showTimestamps
                            ? 'bg-content text-base border-content'
                            : 'bg-surface-elevated text-content-secondary border-line'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>Timestamps</span>
                      </button>
                      {!showTimestamps && (
                        <button
                          type="button"
                          onClick={() => setCleanAiMode((v) => !v)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            cleanAiMode
                              ? 'bg-content text-base border-content'
                              : 'bg-surface-elevated text-content-secondary border-line'
                          }`}
                        >
                          <span>Clean text for AI / Notion</span>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={copyContent}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface-elevated text-xs font-semibold text-content hover:border-line-hover"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      {(['txt', 'srt', 'vtt', 'md'] as const).map((ext) => (
                        <button
                          key={ext}
                          type="button"
                          onClick={() => downloadFile(ext)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-content text-base text-xs font-semibold uppercase hover:opacity-90"
                        >
                          <Download className="w-3 h-3" />
                          <span>.{ext}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Transcript Viewer */}
                  <div className="max-h-[480px] overflow-y-auto rounded-xl border border-line bg-base p-4 space-y-2.5 text-sm leading-relaxed">
                    {showTimestamps ? (
                      filteredCues.length > 0 ? (
                        filteredCues.map((cue) => (
                          <div
                            key={cue.index}
                            className="flex items-start gap-3 py-1 border-b border-line-subtle last:border-0"
                          >
                            <span className="font-mono text-xs text-content-secondary tabular-nums shrink-0 pt-0.5 select-none">
                              {cue.startTime}
                            </span>
                            <span className="text-content">{cue.text}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-content-secondary">No matching lines found.</p>
                      )
                    ) : (
                      <div className="whitespace-pre-wrap text-content">
                        {cleanAiMode
                          ? transcript.cleanText || transcript.plainText
                          : transcript.plainText}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
