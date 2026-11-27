import React from 'react';
import type { Metadata } from 'next';
import DesktopAppShell from '@/components/native/DesktopAppShell';
import { constructMetadata } from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'MUXARO Desktop Studio — Local Workstation',
  description:
    'Dedicated local desktop studio for PDF tools, Camera PDF scanner filters, Google Drive import, and local FFmpeg media processing.',
  path: '/app',
});

export default function DesktopAppPage() {
  return <DesktopAppShell />;
}
