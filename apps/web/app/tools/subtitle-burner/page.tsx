'use client';

import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import StudioToolShell from '@/components/tools/StudioToolShell';
import { shiftSubtitlesLocal } from '@/lib/tier1-local';

const SAMPLE_SRT = `1
00:00:00,500 --> 00:00:03,200
Welcome back — today we test MUXARO Studio.

2
00:00:03,400 --> 00:00:06,800
Zero re-upload chaining keeps your workflow fast.`;

export default function SubtitleBurnerPage() {
  const [subtitleText, setSubtitleText] = useState<string>(SAMPLE_SRT);
  const [offsetMs, setOffsetMs] = useState<number>(0);
  const [fontSize, setFontSize] = useState<number>(28);
  const [position, setPosition] = useState<'bottom' | 'center' | 'top'>('bottom');
  const [primaryColor, setPrimaryColor] = useState<string>('#FFFFFF');
  const [bold, setBold] = useState<boolean>(true);
  const [action, setAction] = useState<'burn' | 'shift_only'>('burn');
  const [shiftLoading, setShiftLoading] = useState(false);

  const previewCommand = useMemo(() => {
    if (action === 'shift_only') {
      return `muxaro-subshift --offset-ms ${offsetMs} input.srt > shifted.srt`;
    }
    const align = position === 'top' ? 6 : position === 'center' ? 10 : 2;
    return `ffmpeg -i input.mp4 -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,subtitles=subs.srt:force_style='Fontsize=${fontSize},Alignment=${align},Bold=${bold ? -1 : 0}'" -c:v libx264 -crf 19 -c:a copy subtitled.mp4`;
  }, [action, offsetMs, fontSize, position, bold]);

  const handleInstantShiftDownload = () => {
    setShiftLoading(true);
    try {
      const shifted = shiftSubtitlesLocal(subtitleText, offsetMs, 'srt');
      if (shifted.count > 0) {
        const blob = new Blob([shifted.content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `subtitles-${offsetMs >= 0 ? 'plus' : 'minus'}${Math.abs(offsetMs)}ms.srt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setShiftLoading(false);
    }
  };

  return (
    <StudioToolShell
      title="Subtitle burner & timing shifter"
      description="Shift SRT/VTT caption sync instantly in your browser (0ms, zero upload) or burn high-legibility stylized captions permanently onto MP4 video."
      badgeText={action === 'shift_only' ? 'Instant JS Shift' : 'Burn-In + Shifter'}
      executionMode={action === 'shift_only' ? 'hybrid' : 'cloud'}
      requiresVideo={action === 'burn'}
      localOnlyWithoutFile={action === 'shift_only'}
      localRunner={
        action === 'shift_only'
          ? async () => {
              const shifted = shiftSubtitlesLocal(subtitleText, offsetMs, 'srt');
              if (shifted.count === 0) return null;
              const blob = new Blob([shifted.content], { type: 'text/plain;charset=utf-8' });
              const filename = `subtitles-${offsetMs >= 0 ? 'plus' : 'minus'}${Math.abs(offsetMs)}ms.srt`;
              return {
                blob,
                url: URL.createObjectURL(blob),
                filename,
                mimeType: 'text/plain',
                sizeBytes: blob.size,
                command: `muxaro-subshift --offset-ms ${offsetMs} input.srt > ${filename}`,
              };
            }
          : undefined
      }
      submitLabel={action === 'shift_only' ? 'Export Shifted SRT Locally (Instant)' : 'Burn Subtitles onto Video'}
      previewCommand={previewCommand}
      canSubmit={subtitleText.trim().length > 0}
      onBuildJobParams={() => ({
        tool: 'subtitle_burner',
        operation: 'BURN_SUBTITLES',
        targetFormat: action === 'shift_only' ? 'srt' : 'mp4',
        subtitleText,
        offsetMs,
        fontSize,
        position,
        primaryColor,
        bold,
        action,
      })}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setAction('burn')}
            className={`p-3 rounded-xl border text-left text-xs font-bold transition-colors ${
              action === 'burn' ? 'border-content bg-content text-base' : 'border-line bg-surface-elevated text-content'
            }`}
          >
            Burn Captions onto Video (MP4)
          </button>
          <button
            type="button"
            onClick={() => setAction('shift_only')}
            className={`p-3 rounded-xl border text-left text-xs font-bold transition-colors ${
              action === 'shift_only' ? 'border-content bg-content text-base' : 'border-line bg-surface-elevated text-content'
            }`}
          >
            Shift Timing Only (SRT)
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-semibold text-content">SRT or WebVTT subtitles</label>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-content hover:underline cursor-pointer">
                <input
                  type="file"
                  accept=".srt,.vtt,.txt"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setSubtitleText(await f.text());
                  }}
                />
                Load .srt/.vtt file
              </label>
              <button
                type="button"
                disabled={shiftLoading || !subtitleText.trim()}
                onClick={handleInstantShiftDownload}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-[11px] font-medium text-content hover:bg-surface"
              >
                <Download className="w-3 h-3" aria-hidden="true" />
                <span>Quick save .srt</span>
              </button>
            </div>
          </div>
          <textarea
            rows={6}
            value={subtitleText}
            onChange={(e) => setSubtitleText(e.target.value)}
            placeholder="Paste SRT or VTT cues here..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-xs font-mono text-content"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-content-secondary">Sync shift (ms)</span>
            <input
              type="number"
              step={50}
              min={-30000}
              max={30000}
              value={offsetMs}
              onChange={(e) => setOffsetMs(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm font-mono text-content"
            />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-content-secondary">Font size (pt)</span>
            <input
              type="number"
              min={14}
              max={56}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value) || 28)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm font-mono text-content"
            />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-content-secondary">Position</span>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            >
              <option value="bottom">Bottom safe margin</option>
              <option value="center">Center (Reels / TikTok)</option>
              <option value="top">Top</option>
            </select>
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-content-secondary">Caption color</span>
            <select
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            >
              <option value="#FFFFFF">Crisp White</option>
              <option value="#FFE600">Creator Yellow</option>
              <option value="#00F5D4">Mint Cyan</option>
            </select>
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-content cursor-pointer">
          <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />
          <span>Bold outline caption styling (high legibility)</span>
        </label>
      </div>
    </StudioToolShell>
  );
}
