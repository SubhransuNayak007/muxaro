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

  // Dynamic Documentation Articles from Content Registry
  const docRoutes: MetadataRoute.Sitemap = ALL_DOCS.map((doc) => ({
    url: `${SITE_URL}/docs/${doc.slug}`,
    lastModified: new Date(`${doc.lastUpdated}T00:00:00.000Z`),
    changeFrequency: 'monthly',
    priority: 0.75,
  }));

  // Programmatic High-Intent Format Conversion Routes
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

  // Competitor Alternative & Displacement Routes
  const alternativeSlugs = [
    'savefrom-net',
    'y2mate',
    'cobalt-tools',
    'cloudconvert',
    'ytmp3',
  ];
  const alternativeRoutes: MetadataRoute.Sitemap = alternativeSlugs.map((slug) => ({
    url: `${SITE_URL}/alternatives/${slug}`,
    lastModified: currentDate,
    changeFrequency: 'weekly',
    priority: 0.85,
  }));

  return [...staticRoutes, ...convertRoutes, ...alternativeRoutes, ...docRoutes];
}
