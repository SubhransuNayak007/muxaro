'use client';

import React, { useState } from 'react';
import { ShieldCheck, Search, AlertTriangle, Loader2 } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/api-client';
import { formatBytes } from '@/lib/formatters';
import { normalizeMediaUrl } from '@/lib/url-utils';
import { runLocalScrubMetadata } from '@/lib/tier1-local';
import StudioToolShell from '@/components/tools/StudioToolShell';

export default function MetadataScrubberPage() {
  const [inspectTargetUrl, setInspectTargetUrl] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [report, setReport] = useState<any | null>(null);

  const runDeepInspect = async () => {
    setInspectError(null);
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const sourceJobId = sp?.get('sourceJobId') || '';
    const norm = normalizeMediaUrl(inspectTargetUrl);
    if (!norm && !sourceJobId) {
      setInspectError('Enter a video URL above or inspect after stripping metadata.');
      return;
    }
    setInspecting(true);
    try {
      const base = getApiBaseUrl().replace(/\/+$/, '');
      const res = await fetch(`${base}/tools/metadata/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(norm ? { url: norm } : {}),
          ...(sourceJobId ? { sourceJobId } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Metadata probe failed.');
      }
      setReport(json.data);
    } catch (err: any) {
      setInspectError(err?.message || 'Could not inspect metadata.');
    } finally {
      setInspecting(false);
    }
  };

  return (
    <StudioToolShell
      title="Metadata inspector & privacy scrubber"
      description="Inspect exact video codecs, HDR transfer curves, frame rates, and hidden GPS/camera/software tags—then strip every tracking tag losslessly in 1 second."
      badgeText="Zero-Reencode Scrub"
      executionMode="hybrid"
      submitLabel="Strip All Metadata Losslessly"
      previewCommand="ffmpeg -i input.mp4 -map 0:V? -map 0:a? -map_chapters -1 -map_metadata -1 -map_metadata:s -1 -fflags +bitexact -c copy -movflags +faststart clean.mp4"
      instantCommandBadge
      localRunner={async (file, onProgress, signal) => {
        if (!file) return null;
        return runLocalScrubMetadata(file, onProgress, signal);
      }}
      onBuildJobParams={() => ({
        tool: 'metadata_scrubber',
        operation: 'SCRUB_METADATA',
        targetFormat: 'mp4',
      })}
    >
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-content flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
              <span>Deep FFprobe Codec &amp; Privacy Scan</span>
            </h2>
            <p className="text-xs text-content-secondary mt-0.5">
              Optional live probe by URL or chained job ID before scrubbing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={inspectTargetUrl}
              onChange={(e) => setInspectTargetUrl(e.target.value)}
              placeholder="Optional URL to inspect tags..."
              className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs text-content min-w-[210px]"
            />
            <button
              type="button"
              onClick={runDeepInspect}
              disabled={inspecting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface-elevated hover:bg-surface text-xs font-semibold text-content shrink-0"
            >
              {inspecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Inspect</span>
            </button>
          </div>
        </div>

        {inspectError && (
          <p className="text-xs text-red-500">{inspectError}</p>
        )}

        {report && (
          <div className="p-4 rounded-xl border border-line bg-surface-elevated/70 space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-content-secondary">Container</div>
                <div className="font-semibold text-content">{report.formatName}</div>
              </div>
              <div>
                <div className="text-content-secondary">Size / Duration</div>
                <div className="font-mono font-semibold text-content">
                  {formatBytes(report.sizeBytes || 0)} · {Math.round(report.durationSeconds || 0)}s
                </div>
              </div>
              {report.video && (
                <div>
                  <div className="text-content-secondary">Video</div>
                  <div className="font-mono font-semibold text-content">
                    {report.video.codec} · {report.video.width}×{report.video.height} {report.video.fps ? `@ ${report.video.fps}fps` : ''}
                  </div>
                </div>
              )}
              {report.audio && (
                <div>
                  <div className="text-content-secondary">Audio</div>
                  <div className="font-mono font-semibold text-content">
                    {report.audio.codec} · {report.audio.sampleRate ? `${Math.round(report.audio.sampleRate / 1000)}kHz` : ''} · {report.audio.channels}ch
                  </div>
                </div>
              )}
            </div>

            {Array.isArray(report.privacyFindings) && report.privacyFindings.length > 0 && (
              <div className="pt-2 border-t border-line/60 space-y-1">
                <div className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Privacy / device tags detected ({report.privacyFindings.length}):</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 font-mono text-[11px]">
                  {report.privacyFindings.map((tag: any, idx: number) => (
                    <div key={idx} className="truncate text-content-secondary">
                      <span className="text-content">{tag.key}:</span> {tag.value}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </StudioToolShell>
  );
}
