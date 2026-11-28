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
              <span>Workstation</span>
            </Link>
            <Link
              href="/tools/pdf/make-pdf"
              className="muxaro-spring-tap hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated"
            >
              <Camera className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
              <span>Camera Scan</span>
            </Link>
            <Link
              href="/tools/pdf/view"
              className="muxaro-spring-tap hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated"
            >
              <FileText className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span>Reader</span>
            </Link>
            <Link
              href="/tools"
              className="muxaro-spring-tap hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-elevated"
            >
              <Film className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
              <span>All Tools</span>
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

  // Unified Mobile Header when inside APK sub-tools (matches /m MUXARO branding cleanly)
  if (nativeMode === 'apk') {
    return (
      <header
        className="sticky top-0 z-40 w-full border-b border-line bg-surface/90 backdrop-blur-xl"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="px-4 h-12 flex items-center justify-between gap-2 max-w-2xl mx-auto">
          <div className="flex items-center gap-2.5">
            <Link
              href="/m"
              onClick={() => void triggerHapticTap()}
              className="muxaro-spring-tap inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-elevated border border-line text-xs font-semibold text-content"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span>Studio</span>
            </Link>
            <span className="text-xs font-semibold text-content-secondary tracking-tight">MUXARO</span>
          </div>
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

  if (pathname?.startsWith('/m') || pathname?.startsWith('/app') || pathname?.startsWith('/ai')) {
    return null;
  }

  // Hide website marketing footer cleanly inside native .exe and .apk apps
  if (nativeMode === 'exe') {
    return null;
  }

  if (nativeMode === 'apk') {
    return (
      <nav
        aria-label="Mobile workspace bar"
        className="fixed bottom-3 left-4 right-4 z-50 max-w-md mx-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="muxaro-dock-glass rounded-full p-1.5 grid grid-cols-4 border border-line shadow-lg">
          <Link
            href="/m?tab=studio"
            onClick={() => void triggerHapticTap()}
            className="py-1.5 rounded-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-content-secondary hover:text-brand"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            <span>Studio</span>
          </Link>
          <Link
            href="/m?tab=pdf"
            onClick={() => void triggerHapticTap()}
            className="py-1.5 rounded-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-brand font-semibold"
          >
            <FileText className="w-4 h-4" aria-hidden="true" />
            <span>PDF</span>
          </Link>
          <Link
            href="/m?tab=media"
            onClick={() => void triggerHapticTap()}
            className="py-1.5 rounded-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-content-secondary hover:text-brand"
          >
            <Film className="w-4 h-4" aria-hidden="true" />
            <span>Media</span>
          </Link>
          <Link
            href="/m?tab=saved"
            onClick={() => void triggerHapticTap()}
            className="py-1.5 rounded-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-content-secondary hover:text-brand"
          >
            <FolderDown className="w-4 h-4" aria-hidden="true" />
            <span>Files</span>
          </Link>
        </div>
      </nav>
    );
  }

  return <Footer />;
}
