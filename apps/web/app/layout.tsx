import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { Newsreader, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import './motion.css';
import { LayoutHeader, LayoutFooter } from '@/components/LayoutChrome';
import { AuthProvider } from '@/lib/auth-context';
import { OpenedArtifactProvider } from '@/lib/opened-artifact';
import { AnalyticsProvider } from '@/components/AnalyticsProvider';
import { ConsentBanner } from '@/components/ConsentBanner';
import GlobalSmartCommandLazy from '@/components/GlobalSmartCommandLazy';
import NavigationProgress from '@/components/NavigationProgress';
import { buildRootWebAppContextJsonLd } from '@/lib/seo';

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-serif',
});

const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  preload: false,
  variable: '--font-mono',
});

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://muxaro.app')
  .trim()
  .replace(/\/+$/, '');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'MUXARO — All-in-One Video, PDF & Media Studio',
    template: '%s',
  },
  description:
    'All-in-one creator and document studio: 14 hybrid Video & Audio tools, 38 browser-local PDF utilities, and 8K stream downloading with zero credits and zero ads.',
  keywords: [
    'all in one video tools',
    'private pdf tools browser',
    'video compressor 10mb discord',
    'lossless video trimmer',
    'media converter 105 formats',
    'pdf editor merge compress ocr',
    'video downloader 8k',
    'audio loudness normalizer',
    'muxaro',
  ],
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'MUXARO',
    title: 'MUXARO — All-in-One Video, PDF & Media Studio',
    description:
      '14 Video & Audio studio tools, 38 browser-local PDF tools, and 8K stream downloading with zero credits, zero sign-up, and zero ads.',
    images: [
      {
        url: '/brand/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MUXARO — All-in-One Video, PDF & Media Studio',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MUXARO — All-in-One Video, PDF & Media Studio',
    description:
      '14 Video & Audio studio tools, 38 browser-local PDF utilities, and 8K stream downloading with zero credits.',
    images: ['/brand/og-image.png'],
  },
  icons: {
    icon: '/brand/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${newsreader.variable} ${hankenGrotesk.variable} ${ibmPlexMono.variable}`}
    >
      <head>
        <link rel="icon" href="/brand/favicon.svg" type="image/svg+xml" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(buildRootWebAppContextJsonLd(SITE_URL)),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;var t=localStorage.getItem('theme');var isDark=t!=='light';if(isDark){d.classList.add('dark');d.setAttribute('data-theme','dark');}else{d.classList.remove('dark');d.setAttribute('data-theme','light');}var lw=localStorage.getItem('muxaro-lightweight');var usRaw=localStorage.getItem('muxaro_user_settings');var rm=false;if(usRaw){try{rm=Boolean(JSON.parse(usRaw).reduceMotion);}catch(_){}}if(lw==='true'||rm){d.setAttribute('data-lightweight','true');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col justify-between font-sans bg-base text-primary">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-md focus:bg-surface focus:text-content focus:border focus:border-line focus:shadow-md text-sm font-medium"
        >
          Skip to main content
        </a>
        <AuthProvider>
          <OpenedArtifactProvider>
            <AnalyticsProvider>
              <div className="w-full">
                <LayoutHeader />
                <main id="main-content" className="w-full">
                  {children}
                </main>
              </div>
              <LayoutFooter />
              <ConsentBanner />
              <GlobalSmartCommandLazy />
            </AnalyticsProvider>
          </OpenedArtifactProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
