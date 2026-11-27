'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { isNativeAppRuntime } from '@/lib/native-bridge';
import {
  CONSENT_CHANGE_EVENT,
  OPEN_CONSENT_EVENT,
  ConsentPreferences,
  getStoredConsent,
  saveConsentPreferences,
  trackEvent,
} from '@/lib/analytics';

export function ConsentBanner() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [rewardedAdsEnabled, setRewardedAdsEnabled] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isNativeAppRuntime() || pathname?.startsWith('/m') || pathname?.startsWith('/app')) {
      setVisible(false);
      return;
    }
    const stored = getStoredConsent();
    if (stored?.decided) {
      setAnalyticsEnabled(stored.analytics);
      setRewardedAdsEnabled(stored.rewardedAds);
      setVisible(false);
    } else {
      setVisible(true);
    }

    const handleOpen = () => {
      const current = getStoredConsent();
      setAnalyticsEnabled(Boolean(current?.analytics));
      setRewardedAdsEnabled(Boolean(current?.rewardedAds));
      setShowCustom(true);
      setVisible(true);
    };

    const handleSync = (event: Event) => {
      const custom = event as CustomEvent<ConsentPreferences>;
      if (custom.detail?.decided) {
        setAnalyticsEnabled(custom.detail.analytics);
        setRewardedAdsEnabled(custom.detail.rewardedAds);
        setVisible(false);
      }
    };

    window.addEventListener(OPEN_CONSENT_EVENT, handleOpen);
    window.addEventListener(CONSENT_CHANGE_EVENT, handleSync);
    return () => {
      window.removeEventListener(OPEN_CONSENT_EVENT, handleOpen);
      window.removeEventListener(CONSENT_CHANGE_EVENT, handleSync);
    };
  }, [pathname]);

  if (!mounted || !visible) {
    return null;
  }

  const commitChoice = (analytics: boolean, rewardedAds: boolean) => {
    saveConsentPreferences({ analytics, rewardedAds });
    setAnalyticsEnabled(analytics);
    setRewardedAdsEnabled(rewardedAds);
    setVisible(false);
    setShowCustom(false);
    trackEvent('consent_updated', {
      analytics_granted: analytics,
      rewarded_ads_granted: rewardedAds,
    });
  };

  return (
    <aside
      role="region"
      aria-label="Privacy and cookie preferences"
      className="fixed bottom-4 inset-x-4 z-40 pointer-events-none flex justify-center"
    >
      <div className="pointer-events-auto w-full max-w-3xl rounded-2xl bg-surface border border-line shadow-elevated p-4 sm:p-5 text-content">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-elevated border border-line text-brand">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-content">Privacy choices</h2>
                <p className="mt-1 text-xs sm:text-sm text-content-secondary leading-relaxed">
                  Muxaro runs local tools entirely in your browser and uses essential state only for active processing queues. You can optionally allow privacy-safe analytics. Read our{' '}
                  <Link
                    href="/privacy"
                    className="font-medium text-brand underline underline-offset-2 hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Privacy Policy
                  </Link>
                  .
                </p>
              </div>
            </div>
            {showCustom && (
              <button
                type="button"
                onClick={() => setShowCustom(false)}
                aria-label="Collapse custom privacy options"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-elevated text-content-secondary hover:text-content motion-safe:transition-colors active:opacity-90"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {showCustom && (
            <div className="rounded-xl bg-surface-elevated border border-line divide-y divide-line">
              <div className="flex items-center justify-between gap-4 p-3 sm:p-3.5">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-content">Essential cookies</p>
                  <p className="text-xs text-content-secondary">
                    Required for secure sessions, download ownership, and abuse protection.
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-content-secondary whitespace-nowrap">
                  Always on
                </span>
              </div>

              <div className="flex items-center justify-between gap-4 p-3 sm:p-3.5">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-content">Product analytics</p>
                  <p className="text-xs text-content-secondary">
                    Helps us measure speed and reliability without collecting personal URLs or filenames.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={analyticsEnabled}
                  aria-label="Enable product analytics"
                  onClick={() => setAnalyticsEnabled((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-line motion-safe:transition-colors active:opacity-90 ${
                    analyticsEnabled ? 'bg-brand' : 'bg-surface-muted'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-4 w-4 rounded-full bg-surface shadow-sm motion-safe:transition-transform ${
                      analyticsEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {showCustom ? (
              <>
                <button
                  type="button"
                  onClick={() => commitChoice(false, false)}
                  className="inline-flex items-center justify-center rounded-lg border border-line bg-surface-elevated px-3.5 py-2 text-xs sm:text-sm font-medium text-content hover:bg-interactive motion-safe:transition-colors active:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  Essential only
                </button>
                <button
                  type="button"
                  onClick={() => commitChoice(analyticsEnabled, false)}
                  className="muxaro-btn-primary inline-flex items-center justify-center px-4 py-2 text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  Save preferences
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowCustom(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-elevated px-3 py-2 text-xs sm:text-sm font-medium text-content-secondary hover:text-content hover:bg-interactive motion-safe:transition-colors active:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  Customize
                </button>
                <button
                  type="button"
                  onClick={() => commitChoice(false, false)}
                  className="inline-flex items-center justify-center rounded-lg border border-line bg-surface-elevated px-3.5 py-2 text-xs sm:text-sm font-medium text-content hover:bg-interactive motion-safe:transition-colors active:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  Essential only
                </button>
                <button
                  type="button"
                  onClick={() => commitChoice(true, false)}
                  className="muxaro-btn-primary inline-flex items-center justify-center px-4 py-2 text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  Accept all
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
