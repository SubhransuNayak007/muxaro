'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const GlobalSmartCommand = dynamic(() => import('./GlobalSmartCommand'), {
  ssr: false,
});

/**
 * Lightweight launcher that defers hydrating the 52-tool command palette
 * until the user presses Cmd/Ctrl+K, clicks Quick Tools, or drags a file.
 */
export default function GlobalSmartCommandLazy() {
  const [activated, setActivated] = useState<'none' | 'open' | 'drag'>('none');

  useEffect(() => {
    if (activated !== 'none') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActivated('open');
      }
    };

    const onOpenCustom = () => {
      setActivated('open');
    };

    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        setActivated('drag');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('muxaro:open-command', onOpenCustom);
    window.addEventListener('dragenter', onDragEnter);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('muxaro:open-command', onOpenCustom);
      window.removeEventListener('dragenter', onDragEnter);
    };
  }, [activated]);

  if (activated === 'none') return null;
  return (
    <GlobalSmartCommand
      initialOpen={activated === 'open'}
      initialDragOver={activated === 'drag'}
    />
  );
}
