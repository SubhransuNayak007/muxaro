'use client';

import { useState, useEffect } from 'react';

export interface DeviceDetectionState {
  /**
   * True strictly after client-side mount and environment check.
   * ALWAYS false during Server-Side Rendering (SSR) to eliminate hydration mismatches.
   */
  isLoaded: boolean;
  /**
   * True for desktop/laptop environments:
   * Requires fine pointer (mouse / trackpad) and desktop operating system,
   * without mobile device/tablet user-agents.
   */
  isDesktop: boolean;
  /**
   * True for mobile phones and tablets:
   * Matches mobile UA, iPadOS desktop-mode, or touch-first interfaces without fine pointer.
   */
  isMobile: boolean;
  /**
   * True if the device has touch capability (touch screen or coarse pointer).
   */
  isTouch: boolean;
}

const DEFAULT_STATE: DeviceDetectionState = {
  isLoaded: false,
  isDesktop: false,
  isMobile: false,
  isTouch: false,
};

/**
 * Custom React hook for robust, hydration-safe device detection.
 * 
 * Rules:
 * 1. ZERO SSR guessing: Never determine device type or render conditional script prompts during SSR.
 * 2. Strictly measured inside useEffect on the client.
 * 3. Checks window.matchMedia('(pointer: fine)') combined with navigator.userAgent.
 * 4. Defaults safely to non-intrusive UI before client mount (isLoaded = false).
 * 5. Guarantees mobile users are never classified as desktop or shown desktop userscript prompts.
 */
export function useDeviceDetection(): DeviceDetectionState {
  const [state, setState] = useState<DeviceDetectionState>(DEFAULT_STATE);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    const detect = (): DeviceDetectionState => {
      const ua = navigator.userAgent || '';
      const maxTouchPoints = navigator.maxTouchPoints || 0;

      // 1. Media query pointer evaluations (fine = mouse/trackpad, coarse = touchscreen/finger)
      const hasFinePointer = typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: fine)').matches
        : false;
      const hasCoarsePointer = typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
        : false;

      // 2. Touch capability
      const isTouch = maxTouchPoints > 0 || hasCoarsePointer;

      // 3. User agent classification
      // Standard mobile & tablet patterns
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

      // iPadOS 13+ desktop-class Safari detection (reports MacIntel platform with multi-touch)
      const isIPadOS = navigator.platform === 'MacIntel' && maxTouchPoints > 1;

      // Explicit desktop operating systems (Windows, macOS, Linux desktop)
      const isDesktopOS = /Windows NT|Macintosh|X11; Linux x86_64/i.test(ua) && !isIPadOS;

      // Small screen viewport heuristic (phones/small phablets)
      const isSmallScreen = window.innerWidth <= 768;

      // 4. Combined determination
      // If mobile UA, iPadOS, or touch screen without desktop OS -> Mobile/Tablet
      const isMobile = isMobileUA || isIPadOS || (isTouch && !isDesktopOS) || (isTouch && !hasFinePointer && isSmallScreen);

      // Desktop requires not being mobile, plus fine pointer or desktop OS without touch-only limitation
      const isDesktop = !isMobile && (hasFinePointer || isDesktopOS);

      return {
        isLoaded: true,
        isDesktop,
        isMobile,
        isTouch,
      };
    };

    // Initial detection on client mount
    setState(detect());

    // Listen for media query pointer changes (e.g., tablet docked to precision trackpad/mouse)
    let fineMql: MediaQueryList | null = null;
    let coarseMql: MediaQueryList | null = null;

    const handleChange = () => {
      setState(detect());
    };

    if (typeof window.matchMedia === 'function') {
      fineMql = window.matchMedia('(pointer: fine)');
      coarseMql = window.matchMedia('(pointer: coarse)');
      if (fineMql.addEventListener) {
        fineMql.addEventListener('change', handleChange);
      }
      if (coarseMql.addEventListener) {
        coarseMql.addEventListener('change', handleChange);
      }
    }

    return () => {
      if (fineMql?.removeEventListener) {
        fineMql.removeEventListener('change', handleChange);
      }
      if (coarseMql?.removeEventListener) {
        coarseMql.removeEventListener('change', handleChange);
      }
    };
  }, []);

  return state;
}
