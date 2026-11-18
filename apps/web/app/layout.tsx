import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { AuthProvider } from '@/lib/auth-context';
import { AnalyticsProvider } from '@/components/AnalyticsProvider';
import { ConsentBanner } from '@/components/ConsentBanner';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-mono',
});

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://muxaro.app')
  .trim()
  .replace(/\/+$/, '');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'MUXARO — Your Media. One Powerful Workspace.',
  description:
    'Convert videos, extract studio-grade audio, and combine tracks in one fast, private workspace.',
  keywords: [
    'media converter',
    'video converter',
    'audio extractor',
    'merge video and audio',
    'lossless audio',
    '8k video processing',
    'muxaro workspace',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'MUXARO',
    title: 'MUXARO — Your Media. One Powerful Workspace.',
    description:
      'Convert videos, extract studio-grade audio, and combine tracks in one fast, private workspace.',
    images: [
      {
        url: '/brand/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MUXARO — Your Media. One Powerful Workspace.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MUXARO — Your Media. One Powerful Workspace.',
    description:
      'Convert videos, extract studio-grade audio, and combine tracks in one fast, private workspace.',
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
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <link rel="icon" href="/brand/favicon.svg" type="image/svg+xml" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;var t=localStorage.getItem('theme');if(t==='dark'){d.classList.add('dark');d.setAttribute('data-theme','dark');}else{d.classList.remove('dark');d.setAttribute('data-theme','light');}if(localStorage.getItem('muxaro-lightweight')==='true'){d.setAttribute('data-lightweight','true');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col justify-between font-sans bg-base text-primary">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-md focus:bg-surface focus:text-content focus:border focus:border-line focus:shadow-md text-sm font-medium"
        >
          Skip to main content
        </a>
        <AuthProvider>
          <AnalyticsProvider>
            <div className="w-full">
              <Navbar />
              <main id="main-content" className="w-full">
                {children}
              </main>
            </div>
            <Footer />
            <ConsentBanner />
          </AnalyticsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
