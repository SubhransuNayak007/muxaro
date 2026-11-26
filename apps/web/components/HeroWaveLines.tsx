'use client';

import React from 'react';
import { useDeviceMode } from '@/lib/device-mode';

/**
 * HeroWaveLines
 *
 * Minimalist architectural contour hairlines using foreground token strokes.
 * Renders nothing in Eco / Lightweight mode to eliminate SVG paint overhead.
 */
export default function HeroWaveLines() {
  const { lightweight } = useDeviceMode();

  if (lightweight) {
    return null;
  }

  return (
    <div
      data-eco-hide="true"
      className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0"
      aria-hidden="true"
    >
      <svg
        className="w-full h-full object-cover text-content opacity-[0.07] dark:opacity-[0.09]"
        viewBox="0 0 1440 480"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <path
          d="M-100 380 C 300 240, 800 480, 1540 280"
          stroke="url(#wave-gradient)"
          strokeWidth="1.2"
        />
        <path
          d="M-100 400 C 320 260, 820 460, 1540 310"
          stroke="url(#wave-gradient)"
          strokeWidth="1.0"
        />
        <path
          d="M-100 420 C 340 280, 840 440, 1540 340"
          stroke="url(#wave-gradient)"
          strokeWidth="0.8"
        />
        <path
          d="M-100 440 C 360 300, 860 420, 1540 370"
          stroke="url(#wave-gradient)"
          strokeWidth="0.8"
        />
        <path
          d="M-100 460 C 380 320, 880 400, 1540 400"
          stroke="url(#wave-gradient)"
          strokeWidth="0.6"
        />
        <defs>
          <linearGradient id="wave-gradient" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="0.7" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.2" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
