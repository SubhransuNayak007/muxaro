'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useDeviceMode } from '@/lib/device-mode';

export default function CursorSpotlight() {
  const { lightweight } = useDeviceMode();
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: -1000, y: -1000 });
  const [opacity, setOpacity] = useState(0);
  const targetPosRef = useRef({ x: -1000, y: -1000 });
  const currentPosRef = useRef({ x: -1000, y: -1000 });
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (lightweight) {
      setOpacity(0);
      return;
    }

    const mediaQuery = window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)');
    if (!mediaQuery.matches) return;

    const tick = () => {
      const dx = targetPosRef.current.x - currentPosRef.current.x;
      const dy = targetPosRef.current.y - currentPosRef.current.y;

      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
        animFrameRef.current = null;
        return;
      }

      const next = {
        x: currentPosRef.current.x + dx * 0.14,
        y: currentPosRef.current.y + dy * 0.14,
      };
      currentPosRef.current = next;
      setPosition(next);
      animFrameRef.current = requestAnimationFrame(tick);
    };

    const handleMouseMove = (e: MouseEvent) => {
      targetPosRef.current = { x: e.clientX, y: e.clientY };
      setOpacity(1);
      if (animFrameRef.current === null) {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    };

    const handleMouseLeave = () => {
      setOpacity(0);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [lightweight]);

  if (lightweight) {
    return null;
  }

  return (
    <div
      data-eco-hide="true"
      className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-300"
      style={{
        opacity,
        background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, color-mix(in srgb, var(--muxaro-text-primary) 4.5%, transparent), transparent 70%)`,
      }}
      aria-hidden="true"
    />
  );
}
