'use client';

import React, { useMemo, useState } from 'react';
import { Scissors, Layers, Zap } from 'lucide-react';
import StudioToolShell from '@/components/tools/StudioToolShell';
import { runLocalLosslessTrim } from '@/lib/tier1-local';

function parseClockSeconds(v: string): number {
  const s = String(v || '').trim();
  if (!s) return 0;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  return 0;
}

export default function VideoTrimmerPage() {
  const [mode, setMode] = useState<'lossless_copy' | 'frame_accurate' | 'split_60s'>('lossless_copy');
  const [startTime, setStartTime] = useState<string>('00:00:00');
  const [endTime, setEndTime] = useState<string>('00:00:30');
  const [segmentSeconds, setSegmentSeconds] = useState<number>(60);
  const [targetFormat, setTargetFormat] = useState<'mp4' | 'mkv' | 'mov' | 'webm'>('mp4');

  const previewCommand = useMemo(() => {
    if (mode === 'split_60s') {
      return `ffmpeg -i input.mp4 -c copy -map 0 -f segment -segment_time ${segmentSeconds} -reset_timestamps 1 part_%03d.mp4`;
    }
    if (mode === 'frame_accurate') {
      return `ffmpeg -ss ${startTime || '0'} -i input.mp4 -to ${endTime || '30'} -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -crf 20 -c:a aac -b:a 192k -movflags +faststart trimmed.${targetFormat}`;
    }
    return `ffmpeg -ss ${startTime || '0'} -i input.mp4 -to ${endTime || '30'} -c copy -avoid_negative_ts make_zero trimmed.${targetFormat}`;
  }, [mode, startTime, endTime, segmentSeconds, targetFormat]);

  return (
    <StudioToolShell
      title="Instant lossless trimmer & 60s splitter"
      description="Cut clips in 1 second with Stream Copy (zero re-encoding), switch to Frame-Accurate mode, or auto-split long videos into 60-second Reels/Shorts parts."
      badgeText="Stream Copy + Splitter"
      executionMode="hybrid"
      submitLabel={mode === 'split_60s' ? `Split into ${segmentSeconds}s Parts (ZIP)` : 'Trim & Export Clip'}
      previewCommand={previewCommand}
      instantCommandBadge={mode === 'lossless_copy'}
      localRunner={
        mode === 'lossless_copy'
          ? async (file, onProgress, signal) => {
              if (!file) return null;
              const startSec = parseClockSeconds(startTime);
              const endSec = endTime.trim() ? parseClockSeconds(endTime) : null;
              return runLocalLosslessTrim(file, startSec, endSec, targetFormat, onProgress, signal);
            }
          : undefined
      }
      onMediaLoaded={(info) => {
        if (info && info.durationSec > 0) {
          const secs = Math.max(1, Math.round(info.durationSec));
          const h = String(Math.floor(secs / 3600)).padStart(2, '0');
          const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
          const s = String(secs % 60).padStart(2, '0');
          setEndTime(`${h}:${m}:${s}`);
        }
      }}
      onBuildJobParams={() => ({
        tool: 'video_trimmer',
        operation: 'TRIM_SPLIT',
        trimMode: mode,
        startTime,
        endTime: endTime.trim() || undefined,
        segmentSeconds,
        targetFormat,
      })}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setMode('lossless_copy')}
            className={`p-3.5 rounded-xl border text-left transition-colors ${
              mode === 'lossless_copy'
                ? 'border-content bg-content text-base'
                : 'border-line bg-surface-elevated hover:bg-surface text-content'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Zap className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Instant Stream Copy</span>
            </div>
            <p className={`text-[11px] mt-1 ${mode === 'lossless_copy' ? 'opacity-80' : 'text-content-secondary'}`}>
              100% lossless keyframe cut in ~1 second.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode('frame_accurate')}
            className={`p-3.5 rounded-xl border text-left transition-colors ${
              mode === 'frame_accurate'
                ? 'border-content bg-content text-base'
                : 'border-line bg-surface-elevated hover:bg-surface text-content'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Scissors className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Frame-Accurate Cut</span>
            </div>
            <p className={`text-[11px] mt-1 ${mode === 'frame_accurate' ? 'opacity-80' : 'text-content-secondary'}`}>
              Re-encodes boundary frames for exact timestamps.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode('split_60s')}
            className={`p-3.5 rounded-xl border text-left transition-colors ${
              mode === 'split_60s'
                ? 'border-content bg-content text-base'
                : 'border-line bg-surface-elevated hover:bg-surface text-content'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Split into 60s Parts (ZIP)</span>
            </div>
            <p className={`text-[11px] mt-1 ${mode === 'split_60s' ? 'opacity-80' : 'text-content-secondary'}`}>
              Reels, Shorts &amp; WhatsApp Status auto-splitter.
            </p>
          </button>
        </div>

        {mode === 'split_60s' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-content-secondary">Part length (seconds)</span>
              <select
                value={segmentSeconds}
                onChange={(e) => setSegmentSeconds(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              >
                <option value={15}>15s parts (Stories)</option>
                <option value={30}>30s parts (WhatsApp Status)</option>
                <option value={60}>60s parts (YouTube Shorts / Reels)</option>
                <option value={90}>90s parts (IG Reels)</option>
              </select>
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-content-secondary">Start time (HH:MM:SS or sec)</span>
              <input
                type="text"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="00:00:05"
                className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm font-mono text-content"
              />
            </label>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-content-secondary">End time (blank = to end)</span>
              <input
                type="text"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="00:00:35"
                className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm font-mono text-content"
              />
            </label>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-content-secondary">Output container</span>
              <select
                value={targetFormat}
                onChange={(e) => setTargetFormat(e.target.value as any)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm text-content"
              >
                <option value="mp4">MP4 (Universal)</option>
                <option value="mkv">MKV (Lossless container)</option>
                <option value="mov">MOV (QuickTime / Edit)</option>
                <option value="webm">WebM</option>
              </select>
            </label>
          </div>
        )}
      </div>
    </StudioToolShell>
  );
}
