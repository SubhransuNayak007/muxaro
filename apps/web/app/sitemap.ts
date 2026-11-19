import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://muxaro.pages.dev')
  .trim()
  .replace(/\/+$/, '');

const PUBLIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}> = [
  { path: '/', changeFrequency: 'daily', priority: 1.0 },
  { path: '/tools', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/tools/media-converter', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/tools/audio-extractor', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/tools/audio-video-merger', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/tools/video-merger', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/tools/batch-processing', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/tools/playlist-processing', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/tools/playlist-batch', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/docs', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/docs/formats', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/docs/resolutions', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/docs/audio-quality', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/docs/troubleshooting', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/docs/faq', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/docs/security', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/status', changeFrequency: 'hourly', priority: 0.5 },
  { path: '/terms', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/dmca', changeFrequency: 'monthly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date('2026-11-18T00:00:00.000Z');

  return PUBLIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
