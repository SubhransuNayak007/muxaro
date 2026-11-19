import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://muxaro.pages.dev')
  .trim()
  .replace(/\/+$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
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
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
