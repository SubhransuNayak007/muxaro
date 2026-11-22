/** @type {import('next').NextConfig} */
const isCloudflarePages = process.env.CLOUDFLARE_PAGES === '1';

const externalApiUrl = process.env.API_INTERNAL_URL?.trim();
const hasExternalBackend = Boolean(
  externalApiUrl &&
  !externalApiUrl.includes('127.0.0.1') &&
  !externalApiUrl.includes('localhost') &&
  !/api\.muxaro\.app|muxaro-api\.internal/i.test(externalApiUrl)
);

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.ytimg.com',
      },
      {
        protocol: 'https',
        hostname: '**.youtube.com',
      },
      {
        protocol: 'https',
        hostname: '**.cdninstagram.com',
      },
      {
        protocol: 'https',
        hostname: '**.tiktokcdn.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
      {
        source: '/(robots.txt|sitemap.xml|llms.txt|llms-full.txt)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
        ],
      },
      {
        source: '/brand/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
          },
        ],
      },
    ];
  },
  ...(isCloudflarePages
    ? {
        output: 'export',
        images: {
          unoptimized: true,
        },
      }
    : {
        ...(hasExternalBackend
          ? {
              async rewrites() {
                return [
                  {
                    source: '/api/v1/:path*',
                    destination: `${externalApiUrl}/api/v1/:path*`,
                  },
                ];
              },
            }
          : {}),
      }),
};

export default nextConfig;
