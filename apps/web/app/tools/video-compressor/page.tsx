'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { VolumeX, Sparkles } from 'lucide-react';
import { formatBytes } from '@/lib/formatters';
import StudioToolShell, { type ProbedLocalMedia } from '@/components/tools/StudioToolShell';

const PRESETS = [
  { id: 'discord', label: 'Discord Free', mb: 10, note: '10 MB hard cap' },
  { id: 'whatsapp', label: 'WhatsApp', mb: 16, note: '16 MB clip' },
  { id: 'email', label: 'Email / Slack', mb: 25, note: '25 MB share' },
  { id: 'custom', label: 'Custom MB', mb: 50, note: 'Pick any size' },
] as const;

export default function VideoCompressorPage() {
  const [presetId, setPresetId] = useState<(typeof PRESETS)[number]['id']>('discord');
  const [targetSizeMb, setTargetSizeMb] = useState<number>(10);
  const [estDurationSec, setEstDurationSec] = useState<number>(30);
  const [maxResolution, setMaxResolution] = useState<'auto' | '1080p' | '720p' | '480p'>('auto');
  const [muteVideo, setMuteVideo] = useState<boolean>(false);
  const [probedMedia, setProbedMedia] = useState<ProbedLocalMedia | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const preset = (sp.get('preset') || '').toLowerCase();
    const mbParam = Number(sp.get('mb'));
    if (preset === 'discord-10mb' || preset === 'discord') {
      setPresetId('discord');
      setTargetSizeMb(10);
    } else if (preset === 'whatsapp-16mb' || preset === 'whatsapp') {
      setPresetId('whatsapp');
      setTargetSizeMb(16);
    } else if (preset === 'email-25mb' || preset === 'slack' || preset === 'email') {
      setPresetId('email');
      setTargetSizeMb(25);
    } else if (Number.isFinite(mbParam) && mbParam >= 1 && mbParam <= 2000) {
      setPresetId('custom');
      setTargetSizeMb(Math.round(mbParam));
    }
  }, []);

  const isAudioOnly = probedMedia ? !probedMedia.hasVideo : false;

  const budget = useMemo(() => {
    const dur = Math.max(1, estDurationSec || 30);
    if (isAudioOnly) {
      const audioKbps = Math.min(320, Math.max(32, Math.floor((targetSizeMb * 0.95 * 8000) / dur)));
      return {
        totalKbps: audioKbps,
        audioKbps,
        videoKbps: 0,
        effectiveRes: 'audio',
      };
    }
    const totalKbps = Math.floor((targetSizeMb * 0.94 * 8000) / dur);
    const audioKbps = muteVideo ? 0 : Math.min(128, Math.max(48, Math.round(totalKbps / 5)));
    const videoKbps = Math.max(100, totalKbps - audioKbps);
    const autoRes = videoKbps < 380 ? '480p' : videoKbps < 1100 ? '720p' : '1080p';
    return {
      totalKbps,
      audioKbps,
      videoKbps,
      effectiveRes: maxResolution === 'auto' ? autoRes : maxResolution,
    };
  }, [targetSizeMb, estDurationSec, maxResolution, muteVideo, isAudioOnly]);

  const previewCommand = useMemo(() => {
    if (isAudioOnly) {
      return `ffmpeg -i input.flac -vn -c:a libmp3lame -b:a ${budget.audioKbps}k output-${targetSizeMb}mb.mp3`;
    }
    const scaleFlag =
      budget.effectiveRes === '480p'
        ? '-vf "scale=-2:480:flags=lanczos"'
        : budget.effectiveRes === '720p'
        ? '-vf "scale=-2:720:flags=lanczos"'
        : '-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2"';
    const audioFlag = muteVideo ? '-an' : `-c:a aac -b:a ${budget.audioKbps}k`;
    return `ffmpeg -i input.mp4 ${scaleFlag} -c:v libx264 -b:v ${budget.videoKbps}k -pass 2 -preset fast ${audioFlag} -movflags +faststart output-${targetSizeMb}mb.mp4`;
  }, [budget, muteVideo, targetSizeMb, isAudioOnly]);

  const reductionPct = useMemo(() => {
    if (!probedMedia || probedMedia.sizeBytes <= 0) return null;
    const targetBytes = targetSizeMb * 1024 * 1024;
    if (probedMedia.sizeBytes <= targetBytes) return 0;
    return Math.round(((probedMedia.sizeBytes - targetBytes) / probedMedia.sizeBytes) * 100);
  }, [probedMedia, targetSizeMb]);

  const ringRatio = reductionPct !== null ? (100 - reductionPct) / 100 : Math.min(1, targetSizeMb / 50);
  const ringOffset = Math.round(251 * (1 - Math.max(0.08, Math.min(1, ringRatio))));

  return (
    <StudioToolShell
      title="Target-size compressor"
      description="Hit exact upload limits for Discord (10 MB), WhatsApp (16 MB), Slack, or custom targets using true 2-pass video bitrate calculation."
      badgeText={isAudioOnly ? 'Audio Target MP3' : '2-Pass Exact Size'}
      executionMode="cloud"
      submitLabel={
        reductionPct !== null && reductionPct > 0
          ? `Compress to ${targetSizeMb} MB (-${reductionPct}%)`
          : `Compress to ${targetSizeMb} MB`
      }
      previewCommand={previewCommand}
      onMediaLoaded={(info) => {
        setProbedMedia(info);
        if (info && info.durationSec > 0) {
          setEstDurationSec(Math.max(1, Math.round(info.durationSec)));
        }
      }}
      onBuildJobParams={() => ({
        tool: 'video_compressor',
        operation: 'COMPRESS_TARGET',
        targetFormat: isAudioOnly ? 'mp3' : 'mp4',
        targetSizeMb,
        maxResolution,
        muteVideo: isAudioOnly ? false : muteVideo,
      })}
    >
      <div className="space-y-6">
        {isAudioOnly && (
          <div className="p-3.5 rounded-xl border border-success/25 bg-success-bg text-xs text-content flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
            <span>
              Audio track detected: MUXARO switches automatically to target MP3 compression ({budget.audioKbps} kbps).
            </span>
          </div>
        )}

        {/* Preset Switcher Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {PRESETS.map((p) => {
            const active = presetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPresetId(p.id);
                  if (p.id !== 'custom') setTargetSizeMb(p.mb);
                }}
                className={`p-3 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  active
                    ? 'border-brand bg-brand/15 text-content'
                    : 'border-line bg-surface-elevated hover:bg-surface text-content-secondary hover:text-content'
                }`}
              >
                <div className="text-xs font-semibold text-content">{p.label}</div>
                <div className="text-[11px] mt-0.5 text-content-secondary">{p.note}</div>
              </button>
            );
          })}
        </div>

        {/* Squoosh-Inspired Visual Bitrate Gauge + 2-Row Controls */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center pt-2">
          <div className="md:col-span-5 flex items-center gap-4">
            <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0" role="img" aria-label={`Target size ${targetSizeMb} MB`}>
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--muxaro-border)" strokeWidth="8" />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="var(--muxaro-accent)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray="251"
                strokeDashoffset={ringOffset}
                transform="rotate(-90 50 50)"
              />
              <text x="50" y="48" textAnchor="middle" fill="var(--muxaro-text-primary)" fontSize="16" fontWeight="700">
                {targetSizeMb} MB
              </text>
              <text x="50" y="64" textAnchor="middle" fill="var(--muxaro-text-secondary)" fontSize="9">
                {reductionPct !== null && reductionPct > 0 ? `-${reductionPct}%` : 'target'}
              </text>
            </svg>

            <div className="space-y-2 text-xs min-w-0 flex-1">
              {probedMedia && (
                <div className="font-mono text-content-secondary">
                  Source {formatBytes(probedMedia.sizeBytes)}
                </div>
              )}
              {!isAudioOnly && (
                <div className="font-mono text-content">
                  Video {budget.videoKbps} kbps
                </div>
              )}
              <div className="font-mono text-content-secondary">
                {!isAudioOnly && muteVideo ? 'Audio muted' : `Audio ${budget.audioKbps} kbps`}
              </div>
              {!isAudioOnly && (
                <button
                  type="button"
                  onClick={() => setMuteVideo((v) => !v)}
                  aria-pressed={muteVideo}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                    muteVideo
                      ? 'border-brand bg-brand/15 text-content'
                      : 'border-line bg-surface-elevated text-content-secondary hover:text-content'
                  }`}
                >
                  <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{muteVideo ? 'Audio muted' : 'Strip audio'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="md:col-span-7 space-y-4">
            {/* 2-Row Slider + Inline Editable Number */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="target-mb-input" className="font-medium text-content-secondary">
                  Target size (MB)
                </label>
                <input
                  id="target-mb-input"
                  type="number"
                  min={1}
                  max={2000}
                  value={targetSizeMb}
                  onChange={(e) => {
                    setPresetId('custom');
                    setTargetSizeMb(Math.max(1, Math.min(2000, Number(e.target.value) || 10)));
                  }}
                  className="w-20 px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-xs text-right text-content font-mono"
                />
              </div>
              <input
                type="range"
                min={2}
                max={100}
                value={Math.min(100, targetSizeMb)}
                aria-label="Target size slider"
                onChange={(e) => {
                  setPresetId('custom');
                  setTargetSizeMb(Number(e.target.value));
                }}
                className="w-full accent-brand"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-xs font-medium text-content-secondary">
                  {probedMedia?.durationSec ? 'Detected duration (s)' : 'Duration estimate (s)'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={14400}
                  value={estDurationSec}
                  onChange={(e) => setEstDurationSec(Math.max(1, Number(e.target.value) || 30))}
                  className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content font-mono"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-medium text-content-secondary">Resolution cap</span>
                <select
                  value={maxResolution}
                  disabled={isAudioOnly}
                  onChange={(e) => setMaxResolution(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-xs text-content disabled:opacity-50"
                >
                  <option value="auto">Auto ({isAudioOnly ? 'Audio' : budget.effectiveRes})</option>
                  <option value="1080p">Max 1080p</option>
                  <option value="720p">Max 720p</option>
                  <option value="480p">Max 480p</option>
                </select>
              </label>
            </div>
          </div>
        </div>
      </div>
    </StudioToolShell>
  );
}
