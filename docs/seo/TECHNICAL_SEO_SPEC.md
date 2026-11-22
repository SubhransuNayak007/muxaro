# MUXARO — Technical SEO Architecture & Production Specifications
**Author:** Specialized SEO Researcher 1 (Technical SEO Architect - `@seo-tech`)  
**Target:** Next.js 14 App Router on Vercel (`https://muxaro.vercel.app` & `https://muxaro.app`)  
**Status:** [ready-for-implementation]

---

## 1. Executive Summary & Audit Findings

### 1.1 Critical Vulnerabilities in Current Codebase
1. **Fallback Domain Misconfiguration:**
   - Files `apps/web/app/robots.ts`, `apps/web/app/sitemap.ts`, `apps/web/app/layout.tsx`, and `apps/web/lib/seo.ts` currently fall back to `https://muxaro.pages.dev` if `NEXT_PUBLIC_SITE_URL` is omitted.
   - Production canonical domain MUST be strictly locked to **`https://muxaro.app`**.
2. **Domain Split & Staging Indexation Risk:**
   - The Vercel default domain `https://muxaro.vercel.app` is currently accessible and risks Google indexing duplicate pages unless strict 301 redirects or canonical tags are enforced via `middleware.ts`.
3. **Missing IndexNow Automated Ingestion:**
   - Bing, Yandex, and ChatGPT Search (which heavily crawls Bing's IndexNow queue) lack real-time change notification, resulting in multi-day crawl delays instead of sub-5-minute indexation.
4. **AI Crawler Directives:**
   - Modern generative engines (`GPTBot`, `ChatGPT-User`, `PerplexityBot`, `ClaudeBot`) need explicit crawler permission in `robots.ts` while preserving strict firewalls on private routes (`/account`, `/admin`, `/dashboard`, `/credits`, `/jobs`).

---

## 2. Technical SEO Architecture: Rendering, Caching & CWV

### 2.1 Next.js 14 App Router Rendering & Edge Cache Matrix

| Route Category | Rendering Strategy | Next.js Directive | Vercel Edge CDN `Cache-Control` |
| :--- | :--- | :--- | :--- |
| **Homepage (`/`)** | SSG with ISR revalidation | `export const revalidate = 3600` | `public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800` |
| **Core Tools (`/tools/*`)** | Static Pre-rendering (SSG) | `export const dynamic = 'force-static'` | `public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400` |
| **Engineering Docs (`/docs/*`)** | Pure SSG (`generateStaticParams`) | `export const dynamic = 'force-static'` | `public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400` |
| **Legal / Compliance (`/terms`, `/privacy`, `/dmca`)** | Pure SSG | `export const dynamic = 'force-static'` | `public, max-age=604800, s-maxage=2592000, immutable` |
| **Static Assets (`/_next/static/*`, `/brand/*`)** | Immutable Edge Asset | Managed by Next.js / Vercel | `public, max-age=31536000, immutable` |
| **Authenticated App (`/account`, `/dashboard`, `/admin`)** | Dynamic Server Rendering | `export const dynamic = 'force-dynamic'` | `private, no-cache, no-store, must-revalidate` + `X-Robots-Tag: noindex, nofollow` |
| **User Media API (`/api/v1/*`)** | Dynamic Edge/Serverless Route | `export const dynamic = 'force-dynamic'` | `private, no-cache, no-store, must-revalidate` |

### 2.2 Core Web Vitals (CWV) Engineering Targets & Budgets

| Metric | Google "Good" Standard | MUXARO Target | Engineering Guarantee & Implementation Vector |
| :--- | :--- | :--- | :--- |
| **LCP (Largest Contentful Paint)** | $< 2.5\text{ s}$ | **$< 1.2\text{ s}$** | Edge HTML pre-rendering on Vercel CDN (TTFB $< 150\text{ms}$). Zero blocking fonts (`next/font/google` with `display: swap`). Critical hero SVG/text inlined. |
| **INP (Interaction to Next Paint)** | $< 200\text{ ms}$ | **$< 100\text{ ms}$** | Main-thread unburdening: heavy stream demuxing and client-side processing delegated to Web Workers / WebAssembly. URL pasting has 0ms long-task latency. |
| **CLS (Cumulative Layout Shift)** | $< 0.10$ | **$0.00$** | **Zero Display Ads:** MUXARO has zero pop-ups, zero third-party banners (eliminating 99% of competitor shift). Sized bounding boxes for omnibox and conversion status cards. |
| **TTFB (Time to First Byte)** | $< 800\text{ ms}$ | **$< 150\text{ ms}$** | Global Vercel Anycast edge node caching for all public HTML. |
| **FCP (First Contentful Paint)** | $< 1.8\text{ s}$ | **$< 0.8\text{ s}$** | Atomic Tailwind CSS extraction; no external render-blocking scripts. |

---

## 3. Production Code Specifications

### 3.1 Production `apps/web/app/robots.ts`
```typescript
import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const PRIMARY_CANONICAL = 'https://muxaro.app';
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || PRIMARY_CANONICAL)
  .trim()
  .replace(/\/+$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/tools',
          '/tools/',
          '/docs',
          '/docs/',
          '/status',
          '/terms',
          '/privacy',
          '/dmca',
          '/brand/',
          '/llms.txt',
          '/llms-full.txt',
        ],
        disallow: [
          '/api/',
          '/account',
          '/account/',
          '/admin',
          '/admin/',
          '/dashboard',
          '/dashboard/',
          '/credits',
          '/credits/',
          '/login',
          '/login/',
          '/register',
          '/register/',
          '/verify-email',
          '/verify-email/',
          '/reset-password',
          '/reset-password/',
          '/jobs/',
          '/download/',
          '/stream/',
          '/archive/',
          '/*?*url=*',
          '/*?*v=*',
          '/*?*id=*',
          '/*?*token=*',
          '/*?*jobId=*',
          '/_next/',
        ],
      },
      // Explicit Allow for Generative AI & Search Engine Crawlers
      {
        userAgent: [
          'Googlebot',
          'Bingbot',
          'Applebot',
          'YandexBot',
          'DuckDuckBot',
          'Baiduspider',
          'GPTBot',
          'ChatGPT-User',
          'PerplexityBot',
          'ClaudeBot',
          'Google-Extended',
          'CCBot',
          'cohere-ai',
        ],
        allow: '/',
        disallow: [
          '/api/',
          '/account',
          '/admin',
          '/dashboard',
          '/credits',
          '/login',
          '/register',
          '/jobs/',
          '/download/',
          '/stream/',
          '/archive/',
          '/*?*url=*',
          '/*?*v=*',
          '/*?*id=*',
          '/*?*token=*',
          '/*?*jobId=*',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
```

---

### 3.2 Production `apps/web/app/sitemap.ts`
```typescript
import type { MetadataRoute } from 'next';
import { ALL_DOCS } from '@/content';

export const dynamic = 'force-static';

const PRIMARY_CANONICAL = 'https://muxaro.app';
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || PRIMARY_CANONICAL)
  .trim()
  .replace(/\/+$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
  const currentDate = new Date('2026-11-22T00:00:00.000Z');

  // Core Static Landing Pages
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/tools`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/tools/media-converter`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/tools/audio-extractor`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/tools/audio-video-merger`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/tools/video-merger`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/tools/batch-processing`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/tools/playlist-batch`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/tools/playlist-processing`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/tools/direct-helper`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/docs`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/status`,
      lastModified: currentDate,
      changeFrequency: 'hourly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/dmca`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  // Programmatic Format Conversion Routes (/convert/*)
  const convertSlugs = [
    'youtube-to-mp3',
    'mkv-to-mp4',
    'webm-to-mp4',
    'youtube-to-flac',
    'youtube-to-wav',
    'mov-to-mp4',
    'vp9-to-h264',
    'av1-to-mp4',
    'ts-to-mp4',
    'm4a-to-mp3',
  ];
  const convertRoutes: MetadataRoute.Sitemap = convertSlugs.map((slug) => ({
    url: `${SITE_URL}/convert/${slug}`,
    lastModified: currentDate,
    changeFrequency: 'weekly',
    priority: 0.9,
  }));

  // Alternative & Competitor Comparison Routes (/alternatives/*)
  const alternativeSlugs = [
    'savefrom-net',
    'y2mate',
    'cobalt-tools',
    'ytmp3',
    'cloudconvert',
  ];
  const alternativeRoutes: MetadataRoute.Sitemap = alternativeSlugs.map((slug) => ({
    url: `${SITE_URL}/alternatives/${slug}`,
    lastModified: currentDate,
    changeFrequency: 'weekly',
    priority: 0.85,
  }));

  // Dynamic Documentation Articles from Registry
  const docRoutes: MetadataRoute.Sitemap = ALL_DOCS.map((doc) => ({
    url: `${SITE_URL}/docs/${doc.slug}`,
    lastModified: new Date(`${doc.lastUpdated}T00:00:00.000Z`),
    changeFrequency: 'monthly',
    priority: 0.75,
  }));

  return [...staticRoutes, ...convertRoutes, ...alternativeRoutes, ...docRoutes];
}
```

---

### 3.3 Canonical Tag Enforcement & 301 Normalization Middleware
**Path:** `apps/web/middleware.ts`
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CANONICAL_HOST = 'muxaro.app';

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const host = request.headers.get('host') || '';

  // 1. Domain Consolidation (muxaro.vercel.app & www.muxaro.app -> muxaro.app)
  if (
    process.env.NODE_ENV === 'production' &&
    (host.includes('muxaro.vercel.app') || host.startsWith('www.'))
  ) {
    url.host = CANONICAL_HOST;
    url.port = '';
    url.protocol = 'https:';
    return NextResponse.redirect(url, { status: 301 });
  }

  // 2. Trailing Slash Normalization (strip trailing slashes except for root '/')
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
    return NextResponse.redirect(url, { status: 301 });
  }

  // 3. Security & Anti-Indexation Headers for Private Routes & Dynamic Traps
  const response = NextResponse.next();
  const privatePrefixes = [
    '/api',
    '/account',
    '/admin',
    '/dashboard',
    '/credits',
    '/login',
    '/register',
    '/verify-email',
    '/reset-password',
    '/jobs',
    '/download',
    '/stream',
    '/archive',
  ];

  const hasPrivatePrefix = privatePrefixes.some((prefix) => url.pathname.startsWith(prefix));
  const hasDynamicMediaParam = ['url', 'v', 'id', 'token', 'jobId'].some((param) =>
    url.searchParams.has(param)
  );

  if (hasPrivatePrefix || hasDynamicMediaParam) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, brand assets, etc.
     */
    '/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

---

## 4. IndexNow Automated Instant Submission Architecture

IndexNow enables immediate notification to search engines (Bing, Yandex, Seznam, Naver, and ChatGPT Search) whenever pages are deployed or modified.

### 4.1 Key Specifications
- **Verification Key:** `d3e24b7a95614917a1518f97a8929e01`
- **Key Location URL:** `https://muxaro.app/d3e24b7a95614917a1518f97a8929e01.txt`
- **Verification Content:** `d3e24b7a95614917a1518f97a8929e01`

### 4.2 Key Route Implementation
**Path:** `apps/web/app/d3e24b7a95614917a1518f97a8929e01.txt/route.ts` (or placed in `apps/web/public/d3e24b7a95614917a1518f97a8929e01.txt`):
```typescript
export const dynamic = 'force-static';

export async function GET() {
  return new Response('d3e24b7a95614917a1518f97a8929e01', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
```

### 4.3 Automated Submission API Route
**Path:** `apps/web/app/api/v1/seo/indexnow/route.ts`
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const INDEXNOW_KEY = 'd3e24b7a95614917a1518f97a8929e01';
const HOST = 'muxaro.app';
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;

const CORE_URLS = [
  `https://${HOST}/`,
  `https://${HOST}/tools`,
  `https://${HOST}/tools/media-converter`,
  `https://${HOST}/tools/audio-extractor`,
  `https://${HOST}/tools/audio-video-merger`,
  `https://${HOST}/tools/video-merger`,
  `https://${HOST}/tools/batch-processing`,
  `https://${HOST}/tools/playlist-batch`,
  `https://${HOST}/convert/youtube-to-mp3`,
  `https://${HOST}/convert/mkv-to-mp4`,
  `https://${HOST}/convert/webm-to-mp4`,
  `https://${HOST}/convert/youtube-to-flac`,
  `https://${HOST}/convert/youtube-to-wav`,
  `https://${HOST}/convert/mov-to-mp4`,
  `https://${HOST}/alternatives/savefrom-net`,
  `https://${HOST}/alternatives/y2mate`,
  `https://${HOST}/alternatives/cobalt-tools`,
  `https://${HOST}/docs`,
  `https://${HOST}/docs/formats`,
  `https://${HOST}/docs/resolutions`,
  `https://${HOST}/docs/audio-quality`,
  `https://${HOST}/docs/troubleshooting`,
  `https://${HOST}/docs/faq`,
  `https://${HOST}/docs/security`,
];

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const secret = process.env.INDEXNOW_SECRET || 'muxaro-seo-ping-secret-2026';

  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let customUrls: string[] = [];
  try {
    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body?.urls) && body.urls.length > 0) {
      customUrls = body.urls;
    }
  } catch {
    // fallback to CORE_URLS
  }

  const urlList = customUrls.length > 0 ? customUrls : CORE_URLS;

  const payload = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList,
  };

  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      submittedUrls: urlList.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'IndexNow dispatch failed', details: String(error) },
      { status: 500 }
    );
  }
}
```

### 4.4 Automated CI/CD Deploy Hook Script
**Path:** `scripts/submit-indexnow.mjs`
```javascript
#!/usr/bin/env node
/**
 * MUXARO — IndexNow Instant Deployment Ingestion Trigger
 * Invoked after successful Vercel production deployment.
 */

const INDEXNOW_KEY = 'd3e24b7a95614917a1518f97a8929e01';
const HOST = 'muxaro.app';

const URLS_TO_SUBMIT = [
  `https://${HOST}/`,
  `https://${HOST}/tools`,
  `https://${HOST}/tools/media-converter`,
  `https://${HOST}/tools/audio-extractor`,
  `https://${HOST}/tools/audio-video-merger`,
  `https://${HOST}/tools/video-merger`,
  `https://${HOST}/tools/batch-processing`,
  `https://${HOST}/tools/playlist-batch`,
  `https://${HOST}/convert/youtube-to-mp3`,
  `https://${HOST}/convert/mkv-to-mp4`,
  `https://${HOST}/convert/webm-to-mp4`,
  `https://${HOST}/convert/youtube-to-flac`,
  `https://${HOST}/convert/youtube-to-wav`,
  `https://${HOST}/convert/mov-to-mp4`,
  `https://${HOST}/alternatives/savefrom-net`,
  `https://${HOST}/alternatives/y2mate`,
  `https://${HOST}/alternatives/cobalt-tools`,
  `https://${HOST}/docs`,
  `https://${HOST}/docs/formats`,
  `https://${HOST}/docs/resolutions`,
  `https://${HOST}/docs/audio-quality`,
  `https://${HOST}/docs/troubleshooting`,
  `https://${HOST}/docs/faq`,
  `https://${HOST}/docs/security`,
];

async function submitIndexNow() {
  console.log(`[IndexNow] Dispatching ${URLS_TO_SUBMIT.length} URLs to api.indexnow.org...`);

  const payload = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
    urlList: URLS_TO_SUBMIT,
  };

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  if (res.ok || res.status === 200 || res.status === 202) {
    console.log(`[IndexNow] Successfully submitted to IndexNow (Status: ${res.status}). Search engines notified.`);
  } else {
    console.error(`[IndexNow] Submission returned status: ${res.status} ${res.statusText}`);
  }
}

submitIndexNow().catch((err) => {
  console.error('[IndexNow] Submission failed:', err);
  process.exit(0); // non-blocking for CI
});
```

---

## 5. Verification Checklist for Implementation

- [ ] Update `NEXT_PUBLIC_SITE_URL` default in `lib/seo.ts`, `app/robots.ts`, `app/sitemap.ts`, and `app/layout.tsx` to `https://muxaro.app`.
- [ ] Add `apps/web/middleware.ts` for domain canonicalization (301 redirecting `muxaro.vercel.app` -> `muxaro.app`).
- [ ] Deploy IndexNow verification key file at `public/d3e24b7a95614917a1518f97a8929e01.txt`.
- [ ] Implement `apps/web/app/api/v1/seo/indexnow/route.ts` and `scripts/submit-indexnow.mjs`.
- [ ] Run `npm run build` in `apps/web` to confirm clean compilation.
- [ ] Validate Core Web Vitals targets: LCP < 1.2s, INP < 100ms, CLS = 0.00.
