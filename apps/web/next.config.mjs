/** @type {import('next').NextConfig} */
const isCloudflarePages = process.env.CLOUDFLARE_PAGES === '1';

const candidateOrigin = (
  process.env.API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1:4000'
)
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/api\/v1$/i, '');

const isDeadHost = /api\.muxaro\.app|muxaro-api\.internal/i.test(candidateOrigin);
const rawApiOrigin = isDeadHost ? 'http://127.0.0.1:4000' : candidateOrigin;

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isCloudflarePages
    ? {
        output: 'export',
        images: {
          unoptimized: true,
        },
      }
    : {
        async rewrites() {
          return [
            {
              source: '/api/v1/:path*',
              destination: `${rawApiOrigin}/api/v1/:path*`,
            },
          ];
        },
      }),
};

export default nextConfig;
