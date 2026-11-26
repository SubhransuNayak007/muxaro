'use client';

import React, { useEffect, useRef } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import {
  CONSENT_STORAGE_KEY,
  GA_MEASUREMENT_ID,
  GTM_CONTAINER_ID,
  applyConsentDefaults,
  trackPageView,
} from '@/lib/analytics';
import { ConsentBanner } from './ConsentBanner';

const VALID_GA_ID = /^G-[A-Z0-9]{4,20}$/i;
const VALID_GTM_ID = /^GTM-[A-Z0-9]{4,20}$/i;

export function AnalyticsProvider({
  children,
  includeConsentBanner = false,
}: {
  children?: React.ReactNode;
  includeConsentBanner?: boolean;
}) {
  const pathname = usePathname();
  const initializedRef = useRef(false);

  const safeGaId = VALID_GA_ID.test(GA_MEASUREMENT_ID) ? GA_MEASUREMENT_ID : '';
  const safeGtmId = VALID_GTM_ID.test(GTM_CONTAINER_ID) ? GTM_CONTAINER_ID : '';

  useEffect(() => {
    if (!initializedRef.current) {
      applyConsentDefaults();
      initializedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!pathname) return;
    trackPageView(pathname);
  }, [pathname]);

  const bootstrapScript =
    safeGaId || safeGtmId
      ? [
          'window.dataLayer = window.dataLayer || [];',
          'function gtag(){window.dataLayer.push(arguments);}',
          'window.gtag = window.gtag || gtag;',
          'gtag("consent", "default", {',
          '  analytics_storage: "denied",',
          '  ad_storage: "denied",',
          '  ad_user_data: "denied",',
          '  ad_personalization: "denied",',
          '  wait_for_update: 500',
          '});',
          'try {',
          `  var raw = window.localStorage.getItem(${JSON.stringify(CONSENT_STORAGE_KEY)});`,
          '  if (raw) {',
          '    var c = JSON.parse(raw);',
          '    if (c && c.version === 2 && c.decided) {',
          '      var a = c.analytics ? "granted" : "denied";',
          '      gtag("consent", "update", {',
          '        analytics_storage: a,',
          '        ad_storage: "denied",',
          '        ad_user_data: "denied",',
          '        ad_personalization: "denied"',
          '      });',
          '    }',
          '  }',
          '} catch (e) {}',
          safeGaId ? 'gtag("js", new Date());' : '',
          safeGaId
            ? `gtag("config", ${JSON.stringify(safeGaId)}, { send_page_view: false, allow_google_signals: false });`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '';

  return (
    <>
      {bootstrapScript && (
        <Script id="muxaro-consent-mode-v2" strategy="afterInteractive">
          {bootstrapScript}
        </Script>
      )}

      {safeGaId && (
        <Script
          id="muxaro-ga4-gtag"
          src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(safeGaId)}`}
          strategy="afterInteractive"
        />
      )}

      {safeGtmId && (
        <Script
          id="muxaro-gtm-loader"
          src={`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(safeGtmId)}`}
          strategy="afterInteractive"
        />
      )}

      {children}
      {includeConsentBanner && <ConsentBanner />}
    </>
  );
}
