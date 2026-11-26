'use client';

import React, { useEffect, useMemo, useState } from 'react';
import StudioToolShell from '@/components/tools/StudioToolShell';

const LOUDNESS_TARGETS = [
  { id: 'yt', lufs: -14, tp: -1.0, lra: 11, label: '-14 LUFS · YouTube & Spotify', note: 'Streaming standard' },
  { id: 'podcast', lufs: -16, tp: -1.5, lra: 11, label: '-16 LUFS · Podcasts & Apple', note: 'Spoken-word clarity' },
  { id: 'broadcast', lufs: -23, tp: -1.0, lra: 7, label: '-23 LUFS · EBU R128 Broadcast', note: 'TV & film mastering' },
] as const;

export default function AudioNormalizerPage() {
  const [selectedId, setSelectedId] = useState<(typeof LOUDNESS_TARGETS)[number]['id']>('yt');
  const [targetFormat, setTargetFormat] = useState<'source' | 'mp4' | 'mp3' | 'flac' | 'wav'>('source');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const lufs = sp.get('lufs');
    if (lufs === '-14' || lufs === '14') setSelectedId('yt');
    else if (lufs === '-16' || lufs === '16') setSelectedId('podcast');
    else if (lufs === '-23' || lufs === '23') setSelectedId('broadcast');
  }, []);

  const active = LOUDNESS_TARGETS.find((t) => t.id === selectedId) || LOUDNESS_TARGETS[0];

  const previewCommand = useMemo(() => {
    const outExt = targetFormat === 'source' ? 'mp4' : targetFormat;
    const vidFlag = ['mp3', 'flac', 'wav'].includes(outExt) ? '-vn' : '-c:v copy';
    return `ffmpeg -i input.mp4 ${vidFlag} -af "loudnorm=I=${active.lufs}:TP=${active.tp}:LRA=${active.lra}:linear=true" -ar 48000 output.${outExt}`;
  }, [active, targetFormat]);

  return (
    <StudioToolShell
      title="Audio loudness normalizer"
      description="Fix uneven clip volume in 1 click using true 2-pass EBU R128 linear loudnorm while copying your original video frames untouched."
      badgeText="2-Pass EBU R128"
      executionMode="cloud"
      submitLabel={`Normalize to ${active.lufs} LUFS`}
      previewCommand={previewCommand}
      onBuildJobParams={() => ({
        tool: 'audio_normalizer',
        operation: 'LOUDNORM_AUDIO',
        targetFormat,
        targetLufs: active.lufs,
        truePeak: active.tp,
        lra: active.lra,
      })}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {LOUDNESS_TARGETS.map((preset) => {
            const isSel = selectedId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedId(preset.id)}
                className={`p-3.5 rounded-xl border text-left transition-colors ${
                  isSel
                    ? 'border-content bg-content text-base'
                    : 'border-line bg-surface-elevated hover:bg-surface text-content'
                }`}
              >
                <div className="text-xs font-bold">{preset.label}</div>
                <div className={`text-[11px] mt-1 ${isSel ? 'opacity-80' : 'text-content-secondary'}`}>
                  {preset.note} · True Peak {preset.tp} dBTP
                </div>
              </button>
            );
          })}
        </div>

        <label className="space-y-1.5 block max-w-xs">
          <span className="text-xs font-medium text-content-secondary">Output container</span>
          <select
            value={targetFormat}
            onChange={(e) => setTargetFormat(e.target.value as any)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm text-content"
          >
            <option value="source">Keep original container (video copied lossless)</option>
            <option value="mp4">MP4 (H.264 / AAC)</option>
            <option value="mp3">MP3 320 kbps audio only</option>
            <option value="flac">FLAC lossless audio only</option>
            <option value="wav">WAV PCM audio only</option>
          </select>
        </label>
      </div>
    </StudioToolShell>
  );
}
