/**
 * Global Brand Definition — MUXARO
 * Authoritative single source of truth for branding, typography, metadata, and asset references.
 */

export const BRAND_CONFIG = {
  name: 'MUXARO',
  displayName: 'Muxaro',
  slug: 'muxaro',
  tagline: 'Your Media. One Powerful Workspace.',
  description: 'A powerful platform for authorised media downloading, processing and conversion.',
  shortDescription: 'Clean-room media inspection, processing, conversion, and packaging.',
  legalEntity: 'Muxaro Media Technologies',
  version: '1.0.0',
  domain: 'muxaro.com',
  supportEmail: 'support@muxaro.com',
  copyrightNotice: 'Muxaro Media Technologies. Clean-room architecture baseline.',
  assets: {
    logo: '/brand/muxaro-logo.svg',
    mark: '/brand/muxaro-mark.svg',
    wordmark: '/brand/muxaro-wordmark.svg',
    favicon: '/brand/favicon.svg',
  },
  theme: {
    name: 'blueprint',
    ground: 'oklch(35% 0.105 256)',
    ink: 'oklch(97% 0.012 240)',
    fontDisplay: 'Chakra Petch',
    fontBody: 'IBM Plex Sans',
    fontMono: 'IBM Plex Mono',
  },
} as const;

export type BrandConfig = typeof BRAND_CONFIG;
