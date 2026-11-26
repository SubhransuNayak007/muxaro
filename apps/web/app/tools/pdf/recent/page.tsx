import React from 'react';
import { constructMetadata } from '@/lib/seo';
import PdfRecentHistory from '@/components/pdf/PdfRecentHistory';

export const metadata = constructMetadata({
  title: 'Local PDF History | MUXARO',
  description: 'Inspect, download, or clear PDFs stored locally in your browser IndexedDB workspace.',
  path: '/tools/pdf/recent',
  noIndex: true,
});

export default function PdfRecentPage() {
  return <PdfRecentHistory />;
}
