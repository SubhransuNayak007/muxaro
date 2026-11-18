/** @type {import('next').NextConfig} */
const isCloudflarePages = process.env.CLOUDFLARE_PAGES === '1';

const rawApiOrigin = (
  process.env.API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1:4000'
)
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/api\/v1$/i, '');

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
