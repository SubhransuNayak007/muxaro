/**
 * Web Brand Configuration — MUXARO
 * Local re-export and client helper bindings for Muxaro branding.
 */

export const BRAND = {
  name: 'MUXARO',
  displayName: 'Muxaro',
  slug: 'muxaro',
  tagline: 'Your Media. One Powerful Workspace.',
  description: 'A powerful platform for authorised media downloading, processing and conversion.',
  shortDescription: 'Clean-room media inspection, processing, conversion, and packaging.',
  legalEntity: 'Muxaro Media Technologies',
  version: '1.0.0',
  domain: 'muxaro.com',
  assets: {
    logo: '/brand/muxaro-logo.svg',
    mark: '/brand/muxaro-mark.svg',
    wordmark: '/brand/muxaro-wordmark.svg',
    favicon: '/brand/favicon.svg',
  },
} as const;

export default BRAND;
