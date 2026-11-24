/** @type {import('next').NextConfig} */
const isCloudflarePages = process.env.CLOUDFLARE_PAGES === '1';

const rawApiUrl = (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_BASE_URL || '').trim();
const cleanedApiUrl = rawApiUrl.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');
const enableExplicitProxy = process.env.ENABLE_BACKEND_PROXY === '1' || process.env.ENABLE_BACKEND_PROXY === 'true';
const hasExternalBackend = Boolean(
  cleanedApiUrl &&
  (cleanedApiUrl.startsWith('http://') || cleanedApiUrl.startsWith('https://')) &&
  (enableExplicitProxy || (!cleanedApiUrl.includes('127.0.0.1') && !cleanedApiUrl.includes('localhost')))
);

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverComponentsExternalPackages: ['@distube/ytdl-core'],
    outputFileTracingIncludes: {
      '/**': ['./node_modules/@distube/ytdl-core/**/*'],
    },
  },
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
        source: '/tools/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
      {
        source: '/(ffmpeg|workers)/:path*',
        headers: [
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'cross-origin',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
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
                    destination: `${cleanedApiUrl}/api/v1/:path*`,
                  },
                ];
              },
            }
          : {}),
      }),
};

export default nextConfig;
