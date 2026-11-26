'use client';

import React, { useMemo, useState } from 'react';
import StudioToolShell from '@/components/tools/StudioToolShell';

const RATIOS = [
  { id: '9:16', label: '9:16 Vertical', size: '1080 × 1920', note: 'Reels and Shorts', w: 54, h: 96 },
  { id: '1:1', label: '1:1 Square', size: '1080 × 1080', note: 'Feed post', w: 80, h: 80 },
  { id: '4:5', label: '4:5 Portrait', size: '1080 × 1350', note: 'Instagram feed', w: 68, h: 85 },
  { id: '16:9', label: '16:9 Landscape', size: '1920 × 1080', note: 'YouTube wide', w: 112, h: 63 },
] as const;

export default function AspectRatioPadPage() {
  const [aspectRatio, setAspectRatio] = useState<(typeof RATIOS)[number]['id']>('9:16');
  const [fillMode, setFillMode] = useState<'blur' | 'crop' | 'black'>('blur');
  const [blurStrength, setBlurStrength] = useState<number>(20);

  const activeRatio = RATIOS.find((r) => r.id === aspectRatio) || RATIOS[0];

  const dim =
    aspectRatio === '9:16'
      ? '1080:1920'
      : aspectRatio === '1:1'
      ? '1080:1080'
      : aspectRatio === '4:5'
      ? '1080:1350'
      : '1920:1080';

  const previewCommand = useMemo(() => {
    if (fillMode === 'crop') {
      return `ffmpeg -i input.mp4 -vf "crop=...,scale=${dim}:flags=lanczos,setsar=1" -c:v libx264 -crf 20 -c:a copy reframed.mp4`;
    }
    if (fillMode === 'black') {
      return `ffmpeg -i input.mp4 -vf "scale=${dim}:force_original_aspect_ratio=decrease,pad=${dim}:(ow-iw)/2:(oh-ih)/2:black" -c:v libx264 -crf 20 -c:a copy reframed.mp4`;
    }
    return `ffmpeg -i input.mp4 -filter_complex "[0:v]scale=${dim}:force_original_aspect_ratio=increase,crop=${dim},boxblur=${blurStrength}:2[bg];[0:v]scale=${dim}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]" -map "[v]" -map 0:a? -c:v libx264 -c:a copy reframed.mp4`;
  }, [dim, fillMode, blurStrength]);

  const frameX = Math.round((160 - activeRatio.w) / 2);
  const frameY = Math.round((112 - activeRatio.h) / 2);

  return (
    <StudioToolShell
      title="Aspect ratio and 9:16 smart pad"
      description="Turn widescreen landscape clips into 9:16 Reels, Shorts, or 4:5 portrait videos with blurred fill, center crop, or letterbox padding."
      badgeText="Smart Vertical Reframe"
      executionMode="cloud"
      submitLabel={`Export ${aspectRatio} (${fillMode})`}
      previewCommand={previewCommand}
      requiresVideo
      onBuildJobParams={() => ({
        tool: 'aspect_ratio_pad',
        operation: 'ASPECT_RATIO_PAD',
        targetFormat: 'mp4',
        aspectRatio,
        fillMode,
        blurStrength,
      })}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
          {/* Live Interactive Reframe SVG Preview */}
          <div className="md:col-span-5 flex flex-col items-center justify-center rounded-xl border border-line bg-surface-elevated p-4">
            <svg viewBox="0 0 160 120" className="w-40 h-28" role="img" aria-label={`Live preview of ${aspectRatio} ${fillMode} framing`}>
              <rect
                x={frameX}
                y={frameY}
                width={activeRatio.w}
                height={activeRatio.h}
                rx="6"
                fill={
                  fillMode === 'black'
                    ? 'var(--muxaro-bg-base)'
                    : 'var(--muxaro-accent)'
                }
                fillOpacity={fillMode === 'blur' ? Math.max(0.12, blurStrength / 100) : fillMode === 'crop' ? 0.28 : 1}
                stroke="var(--muxaro-accent)"
                strokeWidth="2"
              />
              {fillMode !== 'crop' && (
                <rect
                  x={frameX + 4}
                  y={Math.round(frameY + activeRatio.h / 2 - (activeRatio.w * 0.48) / 2)}
                  width={activeRatio.w - 8}
                  height={Math.round(activeRatio.w * 0.48)}
                  rx="3"
                  fill="var(--muxaro-bg-surface)"
                  stroke="var(--muxaro-border-hover)"
                />
              )}
              <text x="80" y="116" textAnchor="middle" fill="var(--muxaro-text-secondary)" fontSize="9" fontFamily="monospace">
                {activeRatio.size}
              </text>
            </svg>
          </div>

          <div className="md:col-span-7 space-y-4">
            <div className="grid grid-cols-2 gap-2.5">
              {RATIOS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setAspectRatio(r.id)}
                  className={`p-3 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    aspectRatio === r.id
                      ? 'border-brand bg-brand/15 text-content'
                      : 'border-line bg-surface-elevated hover:bg-surface text-content-secondary hover:text-content'
                  }`}
                >
                  <div className="text-xs font-semibold text-content">{r.label}</div>
                  <div className="text-[11px] mt-0.5 text-content-secondary">{r.note}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'blur', title: 'Blur Fill' },
                  { id: 'crop', title: 'Center Crop' },
                  { id: 'black', title: 'Letterbox' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFillMode(m.id)}
                  className={`py-2 px-3 rounded-xl border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    fillMode === m.id
                      ? 'border-brand bg-brand text-white'
                      : 'border-line bg-surface-elevated text-content-secondary hover:text-content'
                  }`}
                >
                  {m.title}
                </button>
              ))}
            </div>

            {fillMode === 'blur' && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <label htmlFor="blur-strength-range" className="font-medium text-content-secondary">
                    Blur strength
                  </label>
                  <span className="font-mono font-semibold text-content">{blurStrength}</span>
                </div>
                <input
                  id="blur-strength-range"
                  type="range"
                  min={5}
                  max={40}
                  value={blurStrength}
                  onChange={(e) => setBlurStrength(Number(e.target.value))}
                  className="w-full accent-brand"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </StudioToolShell>
  );
}
