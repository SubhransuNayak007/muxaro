'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Smartphone, Monitor } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { isCapacitorApp, isDesktopApp, triggerHapticTap } from '@/lib/native-bridge';

export function LayoutHeader() {
  const pathname = usePathname();
  if (pathname?.startsWith('/m')) {
    return null;
  }
  return <Navbar />;
}

export function LayoutFooter() {
  const pathname = usePathname();
  const [nativeMode, setNativeMode] = useState<'apk' | 'exe' | null>(null);

  useEffect(() => {
    if (isCapacitorApp()) {
      setNativeMode('apk');
    } else if (isDesktopApp()) {
      setNativeMode('exe');
    } else {
      setNativeMode(null);
    }
  }, []);

  if (pathname?.startsWith('/m')) {
    return null;
  }

  // In native Android APK, when visiting any tool page (/tools/...), provide an ergonomic
  // thumb-zone floating pill to return to the dedicated /m Mobile Studio Hub.
  const showMobileReturnPill = nativeMode === 'apk' && pathname && !pathname.startsWith('/m');

  return (
    <>
      {showMobileReturnPill && (
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
      )}

      {nativeMode === 'exe' && (
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-elevated border border-line text-[11px] font-medium text-content-secondary">
            <Monitor className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
            <span>MUXARO Desktop · 100% Local Processing Engine Active</span>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}
