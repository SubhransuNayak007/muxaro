import React from 'react';

/**
 * HeroWaveLines
 * 
 * Minimalist, elegant architectural wave lines inspired by the Violet landing page.
 * Pure vector SVG with subtle 1px strokes, completely static, zero CPU load, zero particles.
 */
export default function HeroWaveLines() {
  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0"
      aria-hidden="true"
    >
      <svg
        className="w-full h-full object-cover opacity-45 dark:opacity-15"
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
            <stop offset="0%" stopColor="#6558F5" stopOpacity="0.08" />
            <stop offset="50%" stopColor="#6558F5" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#31C4DF" stopOpacity="0.15" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
