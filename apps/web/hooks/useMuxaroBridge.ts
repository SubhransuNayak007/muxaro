'use client';

import { useEffect, useState } from 'react';

export interface MuxaroBridgeState {
  isInstalled: boolean;
  isDirectInstalled: boolean;
  checkingDirect: boolean;
  bridgeVersion: string | null;
  isMobile: boolean;
  ping: () => void;
}

/**
 * Custom React hook for robust, sandbox-proof MUXARO Direct companion detection.
 * 
 * Uses bidirectional window.postMessage Ping/Pong handshake:
 * - Crosses Tampermonkey / Violentmonkey Isolated World sandboxes without requiring unsafeWindow.
 * - Solves Next.js hydration race conditions via stepped retries (0ms, 300ms, 1200ms).
 * - Detects mobile & touch devices (where userscripts cannot run) to prevent broken install loops.
 */
export function useMuxaroBridge(): MuxaroBridgeState {
  const [bridgeVersion, setBridgeVersion] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [checkingDirect, setCheckingDirect] = useState<boolean>(true);

  // Robust device classification: True mobile phones & tablets only
  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    const ua = navigator.userAgent || '';

    // Explicit Desktop operating systems: Windows, macOS, Linux
    const isDesktopOS = /Windows NT|Macintosh|X11; Linux x86_64/i.test(ua);
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

    if (isDesktopOS && !isMobileDevice) {
      setIsMobile(false);
      return;
    }

    const isSmallScreen = window.innerWidth <= 768;
    setIsMobile(isMobileDevice || (navigator.maxTouchPoints > 0 && isSmallScreen && !isDesktopOS));
  }, []);

  const ping = () => {
    if (typeof window === 'undefined') return;
    try {
      // Dispatches to both standard MUXARO_APP and legacy MUXARO_DIRECT protocols
      window.postMessage({ source: 'MUXARO_APP', type: 'PING' }, window.location.origin);
      window.postMessage({ type: 'MUXARO_DIRECT_PING' }, window.location.origin);
    } catch {
      // Safe guard against sandboxed contexts
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onMessage = (event: MessageEvent) => {
      // Security: verify origin matches current page
      if (event.origin !== window.location.origin) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Handle standard MUXARO_BRIDGE PONG
      if (data.source === 'MUXARO_BRIDGE' && data.type === 'PONG') {
        setBridgeVersion(data.version || '1.1.0');
        return;
      }

      // Handle legacy MUXARO_DIRECT_READY
      if (data.type === 'MUXARO_DIRECT_READY') {
        setBridgeVersion(data.version || '1.0.0');
        return;
      }
    };

    window.addEventListener('message', onMessage);

    // Initial check: if already announced in documentElement attribute
    if (typeof document !== 'undefined' && document.documentElement) {
      const docVersion = document.documentElement.getAttribute('data-muxaro-version');
      if (docVersion) {
        setBridgeVersion(docVersion);
      }
    }

    // Ping across hydration & document-idle timing windows
    ping();
    const t1 = setTimeout(ping, 300);
    const t2 = setTimeout(ping, 1200);
    const t3 = setTimeout(() => setCheckingDirect(false), 1400);

    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const isInstalled = Boolean(bridgeVersion);

  return {
    isInstalled,
    isDirectInstalled: isInstalled,
    checkingDirect,
    bridgeVersion,
    isMobile,
    ping,
  };
}
