'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * GPU-composited top navigation progress bar.
 * Animates exclusively via transform (scaleX) and opacity.
 */
export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams?.toString() || ''}`;

  const [visible, setVisible] = useState(false);
  const [scale, setScale] = useState(0);
  const timerRef = useRef<number | null>(null);
  const trickleRef = useRef<number | null>(null);
  const prevRouteRef = useRef(routeKey);

  const clearTimers = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (trickleRef.current !== null) {
      window.clearInterval(trickleRef.current);
      trickleRef.current = null;
    }
  };

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (
        !href ||
        href.startsWith('#') ||
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('mailto:') ||
        anchor.target === '_blank'
      ) {
        return;
      }
      if (href === pathname) return;

      clearTimers();
      setVisible(true);
      setScale(0.28);
      trickleRef.current = window.setInterval(() => {
        setScale((prev) => (prev < 0.88 ? Number((prev + (0.88 - prev) * 0.22).toFixed(3)) : prev));
      }, 140);
      // Failsafe complete after 4s if navigation aborted
      timerRef.current = window.setTimeout(() => {
        clearTimers();
        setScale(1);
        timerRef.current = window.setTimeout(() => {
          setVisible(false);
          setScale(0);
        }, 200);
      }, 4000);
    };

    document.addEventListener('click', onDocClick, true);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      clearTimers();
    };
  }, [pathname]);

  useEffect(() => {
    if (prevRouteRef.current === routeKey) return;
    prevRouteRef.current = routeKey;
    clearTimers();
    setVisible(true);
    setScale(1);
    timerRef.current = window.setTimeout(() => {
      setVisible(false);
      setScale(0);
    }, 240);
    return () => clearTimers();
  }, [routeKey]);

  return (
    <div
      aria-hidden="true"
      className="muxaro-nav-progress"
      style={{
        opacity: visible ? 1 : 0,
        transform: `scaleX(${scale})`,
      }}
    />
  );
}
