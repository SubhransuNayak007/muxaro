'use client';

import React, { useEffect, useState } from 'react';
import { Leaf } from 'lucide-react';
import { useDeviceMode } from '@/lib/device-mode';

export interface EcoModeToggleProps {
  className?: string;
  showLabel?: boolean;
}

/**
 * Eco / Low-GPU Mode Switcher.
 * Toggles `<html data-lightweight="true">` across the app to strip GPU-heavy
 * animations, backdrop-blur compositing layers, shadows, and decorative SVGs.
 */
export function EcoModeToggle({ className = '', showLabel = false }: EcoModeToggleProps) {
  const { lightweight, manualLightweight, toggleLightweight } = useDeviceMode();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const active = mounted ? lightweight : false;
  const label = active
    ? 'Eco Mode active (animations & GPU effects off) — click for full motion'
    : 'Enable Eco Mode (cuts animations, blur & GPU usage)';

  return (
    <button
      type="button"
      onClick={toggleLightweight}
      title={label}
      aria-label={label}
      aria-pressed={manualLightweight || active}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
        showLabel ? 'h-9 px-2.5' : 'w-9 h-9 shrink-0'
      } ${
        active
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-line bg-surface hover:bg-surface-muted text-content-secondary hover:text-content'
      } ${className}`}
    >
      <Leaf className="w-4 h-4 shrink-0" aria-hidden="true" />
      {showLabel && <span>{active ? 'Eco On' : 'Eco'}</span>}
    </button>
  );
}
