'use client';

import React, { useMemo, useState } from 'react';
import StudioToolShell from '@/components/tools/StudioToolShell';

export default function VideoToGifPage() {
  const [targetFormat, setTargetFormat] = useState<'gif' | 'webp'>('gif');
  const [fps, setFps] = useState<number>(15);
  const [width, setWidth] = useState<number>(480);
  const [dither, setDither] = useState<'floyd_steinberg' | 'bayer' | 'none'>('floyd_steinberg');
  const [loop, setLoop] = useState<boolean>(true);
  const [startTime, setStartTime] = useState<string>('0');
  const [endTime, setEndTime] = useState<string>('8');

  const previewCommand = useMemo(() => {
    const scaleExpr = width > 0 ? `scale=${width}:-1:flags=lanczos` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
    const ssFlag = Number(startTime) > 0 ? `-ss ${startTime} ` : '';
    const toFlag = endTime.trim() ? `-to ${endTime.trim()} ` : '';
    if (targetFormat === 'webp') {
      return `ffmpeg ${ssFlag}-i input.mp4 ${toFlag}-vf "fps=${fps},${scaleExpr}" -c:v libwebp -lossless 0 -q:v 78 -loop ${loop ? 0 : 1} -an output.webp`;
    }
    return `ffmpeg ${ssFlag}-i input.mp4 ${toFlag}-vf "fps=${fps},${scaleExpr},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=${dither}" -loop ${loop ? 0 : -1} output.gif`;
  }, [targetFormat, fps, width, dither, loop, startTime, endTime]);

  return (
    <StudioToolShell
      title="Video to GIF & Animated WebP"
      description="Create crisp, band-free GIFs using per-frame palettegen color optimization or ultra-light Animated WebP loops with custom FPS and sizing."
      badgeText="PaletteGen Studio"
      executionMode="cloud"
      submitLabel={`Create Animated ${targetFormat.toUpperCase()}`}
      previewCommand={previewCommand}
      requiresVideo
      onBuildJobParams={() => ({
        tool: 'video_to_gif',
        operation: 'VIDEO_TO_GIF',
        targetFormat,
        fps,
        width,
        dither,
        loop,
        startTime: Number(startTime) || 0,
        endTime: endTime.trim() ? Number(endTime) : undefined,
      })}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          {(['gif', 'webp'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => setTargetFormat(fmt)}
              className={`p-3.5 rounded-xl border text-left transition-colors ${
                targetFormat === fmt
                  ? 'border-content bg-content text-base'
                  : 'border-line bg-surface-elevated hover:bg-surface text-content'
              }`}
            >
              <div className="text-xs font-bold uppercase">{fmt === 'gif' ? 'High-Quality GIF' : 'Animated WebP'}</div>
              <div className={`text-[11px] mt-0.5 ${targetFormat === fmt ? 'opacity-80' : 'text-content-secondary'}`}>
                {fmt === 'gif'
                  ? 'Two-pass palettegen · works everywhere'
                  : 'Up to 70% smaller file size · 24-bit color'}
              </div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="space-y-1.5 block">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-content-secondary">Frame rate</span>
              <span className="font-mono font-bold text-content">{fps} FPS</span>
            </div>
            <input
              type="range"
              min={5}
              max={30}
              step={1}
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="w-full accent-content"
            />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-content-secondary">Width resize</span>
            <select
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm text-content"
            >
              <option value={320}>320px (Compact sticker)</option>
              <option value={480}>480px (Standard social)</option>
              <option value={720}>720px (HD showcase)</option>
              <option value={0}>Original width</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-content-secondary">Start time (sec)</span>
            <input
              type="text"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm font-mono text-content"
            />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-content-secondary">End time (sec)</span>
            <input
              type="text"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm font-mono text-content"
            />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-content-secondary">GIF Dithering</span>
            <select
              value={dither}
              disabled={targetFormat !== 'gif'}
              onChange={(e) => setDither(e.target.value as any)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm text-content disabled:opacity-50"
            >
              <option value="floyd_steinberg">Floyd-Steinberg (Smooth gradients)</option>
              <option value="bayer">Bayer (Crisp UI/Pixel)</option>
              <option value="none">None (Smallest flat UI)</option>
            </select>
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-content cursor-pointer">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
            className="rounded border-line"
          />
          <span>Loop infinitely</span>
        </label>
      </div>
    </StudioToolShell>
  );
}
