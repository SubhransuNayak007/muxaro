'use client';

import { useCallback, useEffect, useState } from 'react';

export const LIGHTWEIGHT_STORAGE_KEY = 'muxaro-lightweight';
const LIGHTWEIGHT_EVENT = 'muxaro-lightweight-change';

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
}

export interface DeviceModeState {
  /** True whenever manual lightweight mode, reduced motion, Save-Data, or a 2G connection is active. */
  lightweight: boolean;
  /** True when the user explicitly enabled Lightweight mode via the toggle. */
  manualLightweight: boolean;
  /** Toggle manual Lightweight mode and persist to localStorage + <html data-lightweight>. */
  toggleLightweight: () => void;
  /** Advisory browser Save-Data header preference, when supported. */
  saveData: boolean;
  /** Advisory slow connection detection ('2g' or 'slow-2g'), when supported. */
  slowConnection: boolean;
  /** OS/browser prefers-reduced-motion: reduce preference. */
  reducedMotion: boolean;
  /** True while document.visibilityState === 'hidden' (pauses background animations). */
  tabHidden: boolean;
  /** True only when lightweight is false and the tab is visible. */
  shouldAnimateAurora: boolean;
}

function getNetworkInfo(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const nav = navigator as NavigatorWithConnection;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

function readManualLightweight(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem(LIGHTWEIGHT_STORAGE_KEY) === 'true') {
      return true;
    }
    const rawSettings = window.localStorage.getItem('muxaro_user_settings');
    if (rawSettings) {
      const parsed = JSON.parse(rawSettings);
      if (parsed && parsed.reduceMotion === true) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function setLightweightMode(next: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (next) {
      window.localStorage.setItem(LIGHTWEIGHT_STORAGE_KEY, 'true');
    } else {
      window.localStorage.removeItem(LIGHTWEIGHT_STORAGE_KEY);
    }
    const rawSettings = window.localStorage.getItem('muxaro_user_settings');
    if (rawSettings) {
      const parsed = JSON.parse(rawSettings);
      if (parsed && typeof parsed === 'object') {
        parsed.reduceMotion = next;
        window.localStorage.setItem('muxaro_user_settings', JSON.stringify(parsed));
      }
    }
  } catch {
    // Ignore storage restrictions
  }
  syncHtmlLightweightAttribute(next);
  window.dispatchEvent(new CustomEvent<boolean>(LIGHTWEIGHT_EVENT, { detail: next }));
}

function readNetworkSignals(): { saveData: boolean; slowConnection: boolean } {
  const conn = getNetworkInfo();
  if (!conn) return { saveData: false, slowConnection: false };
  const saveData = Boolean(conn.saveData);
  const effectiveType = typeof conn.effectiveType === 'string' ? conn.effectiveType.toLowerCase() : '';
  const slowConnection = effectiveType === '2g' || effectiveType === 'slow-2g';
  return { saveData, slowConnection };
}

function syncHtmlLightweightAttribute(isLightweight: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (isLightweight) {
    root.setAttribute('data-lightweight', 'true');
  } else {
    root.removeAttribute('data-lightweight');
  }
}

/**
 * Adaptive device & network hook for MUXARO low-end optimisation.
 * Safely feature-detects Save-Data, slow 2G connections, reduced motion,
 * tab visibility, and user-controlled Lightweight mode.
 */
export function useDeviceMode(): DeviceModeState {
  const [manualLightweight, setManualLightweight] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [slowConnection, setSlowConnection] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Initial manual toggle from localStorage
    setManualLightweight(readManualLightweight());

    // 2. prefers-reduced-motion media query
    let mql: MediaQueryList | null = null;
    if (typeof window.matchMedia === 'function') {
      mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mql.matches);
    }

    const handleMotionChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    if (mql) {
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handleMotionChange);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(handleMotionChange);
      }
    }

    // 3. Advisory Network Information API
    const updateNetwork = () => {
      const next = readNetworkSignals();
      setSaveData(next.saveData);
      setSlowConnection(next.slowConnection);
    };
    updateNetwork();

    const conn = getNetworkInfo();
    if (conn && typeof conn.addEventListener === 'function') {
      conn.addEventListener('change', updateNetwork);
    }

    // 4. Page Visibility API (pause Aurora when tab is hidden)
    const handleVisibility = () => {
      if (typeof document !== 'undefined') {
        setTabHidden(document.visibilityState === 'hidden');
      }
    };
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);

    // 5. Cross-component & cross-tab sync for Lightweight mode toggle
    const handleCustomToggle = (event: Event) => {
      const custom = event as CustomEvent<boolean>;
      if (typeof custom.detail === 'boolean') {
        setManualLightweight(custom.detail);
      } else {
        setManualLightweight(readManualLightweight());
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LIGHTWEIGHT_STORAGE_KEY) {
        setManualLightweight(event.newValue === 'true');
      }
    };

    window.addEventListener(LIGHTWEIGHT_EVENT, handleCustomToggle);
    window.addEventListener('storage', handleStorage);

    return () => {
      if (mql) {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', handleMotionChange);
        } else if (typeof mql.removeListener === 'function') {
          mql.removeListener(handleMotionChange);
        }
      }
      if (conn && typeof conn.removeEventListener === 'function') {
        conn.removeEventListener('change', updateNetwork);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(LIGHTWEIGHT_EVENT, handleCustomToggle);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const lightweight = manualLightweight || reducedMotion || saveData || slowConnection;
  const shouldAnimateAurora = !lightweight && !tabHidden;

  useEffect(() => {
    syncHtmlLightweightAttribute(lightweight);
  }, [lightweight]);

  const toggleLightweight = useCallback(() => {
    setManualLightweight((prev) => {
      const next = !prev;
      setLightweightMode(next);
      return next;
    });
  }, []);

  return {
    lightweight,
    manualLightweight,
    toggleLightweight,
    saveData,
    slowConnection,
    reducedMotion,
    tabHidden,
    shouldAnimateAurora,
  };
}
