'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Zap,
  ShieldCheck,
  DownloadCloud,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  Sparkles,
  Layers,
  Flame,
  Info,
} from 'lucide-react';

export default function DirectHelperPage() {
  const [isCompanionActive, setIsCompanionActive] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    function detectBridge() {
      if (
        typeof window !== 'undefined' &&
        ((window as any).__MUXARO_DIRECT_ACTIVE__ === true ||
          document.documentElement.getAttribute('data-muxaro-direct') === 'active')
      ) {
        setIsCompanionActive(true);
        setChecking(false);
      }
    }

    detectBridge();

    const handleReady = () => {
      setIsCompanionActive(true);
      setChecking(false);
    };

    window.addEventListener('muxaro:direct-ready', handleReady);
    const interval = setInterval(detectBridge, 1000);

    const timer = setTimeout(() => {
      setChecking(false);
    }, 2000);

    return () => {
      window.removeEventListener('muxaro:direct-ready', handleReady);
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="min-h-screen py-10 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-12">
      {/* Header Banner */}
      <section className="space-y-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-light border border-brand/20 text-brand text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          <span>True $0 Architecture &amp; Anti-Bot Shield</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-content">
          MUXARO Direct
        </h1>
        <p className="max-w-2xl mx-auto text-sm sm:text-base text-content-secondary leading-relaxed">
          Cloud servers face aggressive YouTube bot challenges and expensive bandwidth egress.
          MUXARO Direct routes downloads directly through your residential connection with zero limits.
        </p>
      </section>

      {/* Live Status Card */}
      <section
        aria-label="Companion status"
        className="p-6 rounded-2xl border border-line bg-surface shadow-sm transition-colors duration-150"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-3.5 h-3.5 rounded-full ${
                isCompanionActive
                  ? 'bg-success motion-safe:animate-pulse'
                  : checking
                  ? 'bg-amber-400 motion-safe:animate-ping'
                  : 'bg-content-muted'
              }`}
              aria-hidden="true"
            />
            <div>
              <h2 className="text-base font-semibold text-content">
                {isCompanionActive
                  ? 'MUXARO Direct is Active'
                  : checking
                  ? 'Detecting MUXARO Direct...'
                  : 'MUXARO Direct Not Installed Yet'}
              </h2>
              <p className="text-xs text-content-secondary mt-0.5">
                {isCompanionActive
                  ? 'All YouTube and direct downloads automatically stream at maximum speed with zero cloud verification challenges.'
                  : 'Install the lightweight companion script below to activate zero-restriction residential mode.'}
              </p>
            </div>
          </div>

          <div className="self-end sm:self-center">
            {isCompanionActive ? (
              <Link
                href="/"
                className="muxaro-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold"
              >
                <span>Back to Downloader</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <a
                href="/muxaro-direct.user.js"
                target="_blank"
                rel="noopener noreferrer"
                className="muxaro-btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold"
              >
                <Zap className="w-4 h-4" aria-hidden="true" />
                <span>1-Click Install Script</span>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-5 rounded-2xl border border-line bg-surface-elevated space-y-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-brand-light text-brand">
            <Zap className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-content">Zero Server Bottlenecks</h3>
          <p className="text-xs text-content-secondary leading-relaxed">
            Media streams directly from YouTube CDN caches to your storage at your full ISP bandwidth. No server queuing or throttling.
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-line bg-surface-elevated space-y-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-brand-light text-brand">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-content">100% Private &amp; Safe</h3>
          <p className="text-xs text-content-secondary leading-relaxed">
            Your connection, cookies, and tokens never touch our servers. Operates completely client-side in your own browser sandbox.
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-line bg-surface-elevated space-y-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-brand-light text-brand">
            <Flame className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-content">No Bot Challenges</h3>
          <p className="text-xs text-content-secondary leading-relaxed">
            YouTube flags cloud datacenter IPs like AWS or Hetzner. By using your authentic residential IP, bot verifications disappear.
          </p>
        </div>
      </section>

      {/* 2-Step Setup Instructions */}
      <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface space-y-6">
        <h2 className="text-lg font-bold text-content">Easy 2-Step Setup (Takes 30 Seconds)</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Step 1 */}
          <div className="p-5 rounded-xl border border-line bg-surface-elevated space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center text-xs font-bold">
                1
              </span>
              <h3 className="text-sm font-semibold text-content">Install a Script Manager</h3>
            </div>
            <p className="text-xs text-content-secondary leading-relaxed">
              Install Violentmonkey (recommended, fast, open-source) or Tampermonkey on your favorite browser:
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <a
                href="https://violentmonkey.github.io/get-it/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted text-content font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span>Violentmonkey (All Browsers)</span>
                <ExternalLink className="w-3 h-3 text-content-muted" aria-hidden="true" />
              </a>
              <a
                href="https://www.tampermonkey.net/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted text-content font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span>Tampermonkey</span>
                <ExternalLink className="w-3 h-3 text-content-muted" aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-5 rounded-xl border border-line bg-surface-elevated space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center text-xs font-bold">
                2
              </span>
              <h3 className="text-sm font-semibold text-content">Activate MUXARO Direct</h3>
            </div>
            <p className="text-xs text-content-secondary leading-relaxed">
              Click the button below. Your script manager will automatically open a confirmation tab. Click <strong>Install</strong>.
            </p>
            <div>
              <a
                href="/muxaro-direct.user.js"
                target="_blank"
                rel="noopener noreferrer"
                className="muxaro-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs font-bold"
              >
                <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Install MUXARO Direct Script</span>
              </a>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-muted text-xs text-content-secondary flex items-start gap-3">
          <Info className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Once installed, whenever you visit YouTube, a convenient <strong>[⚡ MUXARO Direct]</strong> button will appear right under videos. You can also paste links directly on MUXARO with zero cloud blocks.
          </p>
        </div>
      </section>

      {/* Architecture Transparency Note */}
      <section className="text-center text-xs text-content-muted space-y-1">
        <p>MUXARO Hybrid Zero-Cost Engine &bull; Built with standard Web Extensions &amp; Userscript APIs</p>
        <p>No analytics tracking &bull; No remote code execution &bull; 100% open source userscript</p>
      </section>
    </div>
  );
}
