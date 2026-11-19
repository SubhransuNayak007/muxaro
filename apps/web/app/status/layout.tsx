import React from 'react';
import type { Metadata } from 'next';
import { constructMetadata, buildBreadcrumbsJsonLd } from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'System & Network Status | MUXARO',
  description:
    'Live operational status of MUXARO edge endpoints, processing queues, media workers, and conversion pipelines.',
  path: '/status',
  keywords: [
    'muxaro status',
    'system uptime',
    'media worker status',
    'api status',
    'processing queue health',
  ],
});

export default function StatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const breadcrumbsJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'System Status', path: '/status' },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      {children}
    </>
  );
}
