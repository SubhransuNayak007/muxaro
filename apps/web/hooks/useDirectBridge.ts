'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useDeviceDetection } from './useDeviceDetection';

export interface DirectBridgeState {
  isInstalled: boolean;
  isDirectInstalled: boolean;
  checkingDirect: boolean;
  bridgeVersion: string | null;
  isMobile: boolean;
  ping: () => void;
}

/**
 * Custom React hook for robust, secure MUXARO Direct companion detection.
 *
 * Replaces fragile window.__FLAG__ checks with a secure window.postMessage handshake:
 * - Web app dispatches MUXARO_DIRECT_PING with timestamp and nonce.
 * - Userscript listens, verifies origin, and replies with MUXARO_DIRECT_PONG with version.
 * - Handshake retries cleanly at 0ms, 300ms, and 1200ms to eliminate race conditions on page load.
 * - Caches verified state in sessionStorage to eliminate infinite 'install script' prompt loops.
 * - Accurately distinguishes mobile devices so mobile users are never shown desktop userscript install prompts.
 */
export function useDirectBridge(): DirectBridgeState {
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      if (sessionStorage.getItem('muxaro_direct_connected') === 'true') {
        return true;
      }
    } catch (_) {}
    if (typeof document !== 'undefined' && document.documentElement) {
      return document.documentElement.getAttribute('data-muxaro-direct') === 'active';
    }
    return false;
  });

  const [bridgeVersion, setBridgeVersion] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = sessionStorage.getItem('muxaro_direct_version');
      if (cached) return cached;
    } catch (_) {}
    if (typeof document !== 'undefined' && document.documentElement) {
      return document.documentElement.getAttribute('data-muxaro-version');
    }
    return null;
  });

  const { isMobile } = useDeviceDetection();
  const [checkingDirect, setCheckingDirect] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      if (sessionStorage.getItem('muxaro_direct_connected') === 'true') {
        return false;
      }
    } catch (_) {}
    return true;
  });

  const activeNoncesRef = useRef<Set<string>>(new Set());

  const ping = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      activeNoncesRef.current.add(nonce);

      if (activeNoncesRef.current.size > 20) {
        activeNoncesRef.current.clear();
        activeNoncesRef.current.add(nonce);
      }

      const targetOrigin =
        window.location.origin && window.location.origin !== 'null'
          ? window.location.origin
          : '*';

      // 1. Primary secure MUXARO_DIRECT_PING with timestamp and nonce
      window.postMessage(
        {
          type: 'MUXARO_DIRECT_PING',
          source: 'MUXARO_APP',
          timestamp: Date.now(),
          nonce,
        },
        targetOrigin
      );

      // 2. Compatibility ping for legacy bridge listeners
      window.postMessage(
        {
          source: 'MUXARO_APP',
          type: 'PING',
          timestamp: Date.now(),
          nonce,
        },
        targetOrigin
      );
    } catch {
      // Safe guard against sandboxed contexts
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onMessage = (event: MessageEvent) => {
      // Security: verify origin matches current page
      if (event.origin && event.origin !== 'null' && event.origin !== window.location.origin) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Handle secure MUXARO_DIRECT_PONG
      if (data.type === 'MUXARO_DIRECT_PONG') {
        const v = typeof data.version === 'string' ? data.version : '1.2.0';
        setBridgeVersion(v);
        setIsInstalled(true);
        setCheckingDirect(false);
        try {
          sessionStorage.setItem('muxaro_direct_connected', 'true');
          sessionStorage.setItem('muxaro_direct_version', v);
        } catch (_) {}
        return;
      }

      // Handle standard MUXARO_BRIDGE PONG
      if (data.source === 'MUXARO_BRIDGE' && data.type === 'PONG') {
        const v = typeof data.version === 'string' ? data.version : '1.2.0';
        setBridgeVersion(v);
        setIsInstalled(true);
        setCheckingDirect(false);
        try {
          sessionStorage.setItem('muxaro_direct_connected', 'true');
          sessionStorage.setItem('muxaro_direct_version', v);
        } catch (_) {}
        return;
      }

      // Handle legacy MUXARO_DIRECT_READY
      if (data.type === 'MUXARO_DIRECT_READY') {
        const v = typeof data.version === 'string' ? data.version : '1.0.0';
        setBridgeVersion(v);
        setIsInstalled(true);
        setCheckingDirect(false);
        try {
          sessionStorage.setItem('muxaro_direct_connected', 'true');
          sessionStorage.setItem('muxaro_direct_version', v);
        } catch (_) {}
        return;
      }
    };

    const onCustomReady = (event: Event) => {
      const customEvent = event as CustomEvent<{ version?: string }>;
      const v = customEvent?.detail?.version || '1.2.0';
      setBridgeVersion(v);
      setIsInstalled(true);
      setCheckingDirect(false);
      try {
        sessionStorage.setItem('muxaro_direct_connected', 'true');
        sessionStorage.setItem('muxaro_direct_version', v);
      } catch (_) {}
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('muxaro:direct-ready', onCustomReady);

    // Initial check: if already announced in documentElement attribute
    if (typeof document !== 'undefined' && document.documentElement) {
      const docVersion = document.documentElement.getAttribute('data-muxaro-version');
      if (docVersion) {
        setBridgeVersion(docVersion);
        setIsInstalled(true);
        setCheckingDirect(false);
      }
    }

    // Handshake retries cleanly at 0ms, 300ms, and 1200ms to eliminate race conditions on page load
    ping();
    const t1 = setTimeout(ping, 300);
    const t2 = setTimeout(ping, 1200);
    const t3 = setTimeout(() => {
      setCheckingDirect(false);
    }, 1400);

    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('muxaro:direct-ready', onCustomReady);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [ping]);

  return {
    isInstalled,
    isDirectInstalled: isInstalled,
    checkingDirect,
    bridgeVersion,
    isMobile,
    ping,
  };
}
