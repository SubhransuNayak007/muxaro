import React from 'react';
import type { Metadata } from 'next';
import MobileStudioShell from '@/components/mobile/MobileStudioShell';
import { constructMetadata } from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'MUXARO Mobile Studio — Offline PDF & Media App',
  description:
    'Dedicated mobile workspace for scanning documents to PDF, organizing pages, compressing media, and running 52 local tools on device.',
  path: '/m',
});

export default function MobileStudioPage() {
  return <MobileStudioShell />;
}
