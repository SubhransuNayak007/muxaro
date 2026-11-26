import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const PRIMARY_CANONICAL = 'https://muxaro.app';
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || PRIMARY_CANONICAL)
  .trim()
  .replace(/\/+$/, '');

const PRIVATE_DISALLOWS = [
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
  '/settings',
  '/settings/',
  '/downloads',
  '/downloads/',
  '/usage',
  '/usage/',
  '/jobs/',
  '/_next/',
  '/download/',
  '/stream/',
  '/archive/',
  '/*?*url=*',
  '/*?*v=*',
  '/*?*id=*',
  '/*?*token=*',
  '/*?*jobId=*',
];

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
          '/convert',
          '/convert/',
          '/alternatives',
          '/alternatives/',
          '/terms',
          '/privacy',
          '/dmca',
          '/brand/',
          '/llms.txt',
          '/llms-full.txt',
        ],
        disallow: PRIVATE_DISALLOWS,
      },
      // Explicit allowance for Generative AI & Search Engine Crawlers
      {
        userAgent: [
          'Googlebot',
          'Bingbot',
          'Applebot',
          'Applebot-Extended',
          'YandexBot',
          'DuckDuckBot',
          'Baiduspider',
          'GPTBot',
          'ChatGPT-User',
          'PerplexityBot',
          'ClaudeBot',
          'Claude-Web',
          'Google-Extended',
          'CCBot',
          'cohere-ai',
          'OAI-SearchBot',
        ],
        allow: '/',
        disallow: PRIVATE_DISALLOWS,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
