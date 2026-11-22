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
