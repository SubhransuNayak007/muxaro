'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  Smartphone,
  Camera,
  FolderDown,
  FileText,
  Film,
  Home,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  isCapacitorApp,
  isDesktopApp,
  triggerHapticTap,
} from '@/lib/native-bridge';

export function LayoutHeader() {
  const pathname = usePathname();
  const [nativeMode, setNativeMode] = useState<'apk' | 'exe' | null>(null);

  useEffect(() => {
    if (isDesktopApp()) {
      setNativeMode('exe');
    } else if (isCapacitorApp()) {
      setNativeMode('apk');
    } else {
      setNativeMode(null);
    }
  }, []);

  if (pathname?.startsWith('/m') || pathname?.startsWith('/app')) {
    return null;
  }

  // Dedicated Desktop App Top Bar (only inside Windows .exe, never in browser)
  if (nativeMode === 'exe') {
    return (
      <header className="sticky top-0 z-40 w-full border-b border-line bg-surface/85 backdrop-blur-xl">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 h-13 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link
              href="/app"
              className="muxaro-spring-tap inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-elevated border border-line text-xs font-semibold text-content hover:border-line-hover"
            >
              <Home className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span>Studio Desk</span>
            </Link>
            <Link
              href="/tools/pdf/make-pdf"
              className="muxaro-spring-tap hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated"
            >
              <Camera className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
              <span>Camera -&gt; PDF</span>
            </Link>
            <Link
              href="/tools/pdf"
              className="muxaro-spring-tap hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated"
            >
              <FileText className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span>PDF (38)</span>
            </Link>
            <Link
              href="/tools"
              className="muxaro-spring-tap hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated"
            >
              <Film className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
              <span>Media (14)</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void window.muxaroDesktop?.openDownloadsFolder()}
              className="muxaro-spring-tap inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-elevated border border-line text-xs font-medium text-content-secondary hover:text-content"
            >
              <FolderDown className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span className="hidden sm:inline">Downloads</span>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>
    );
  }

  // Dedicated Compact Mobile Header when inside APK sub-tools
  if (nativeMode === 'apk') {
    return (
      <header
        className="sticky top-0 z-40 w-full border-b border-line bg-surface/85 backdrop-blur-xl"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="px-4 h-12 flex items-center justify-between gap-2">
          <Link
            href="/m"
            onClick={() => void triggerHapticTap()}
            className="muxaro-spring-tap inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-elevated border border-line text-xs font-semibold text-content"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
            <span>Mobile Hub</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
    );
  }

  return <Navbar />;
}

export function LayoutFooter() {
  const pathname = usePathname();
  const [nativeMode, setNativeMode] = useState<'apk' | 'exe' | null>(null);

  useEffect(() => {
    if (isDesktopApp()) {
      setNativeMode('exe');
    } else if (isCapacitorApp()) {
      setNativeMode('apk');
    } else {
      setNativeMode(null);
    }
  }, []);

  if (pathname?.startsWith('/m') || pathname?.startsWith('/app')) {
    return null;
  }

  // Hide website marketing footer cleanly inside native .exe and .apk apps
  if (nativeMode === 'exe') {
    return null;
  }

  if (nativeMode === 'apk') {
    return (
      <div
        className="fixed bottom-4 left-4 z-50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <Link
          href="/m"
          onClick={() => void triggerHapticTap()}
          className="muxaro-liquid-glass muxaro-spring-tap inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold text-content shadow-lg border border-line"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
          <Smartphone className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
          <span>Mobile Hub</span>
        </Link>
      </div>
    );
  }

  return <Footer />;
}
