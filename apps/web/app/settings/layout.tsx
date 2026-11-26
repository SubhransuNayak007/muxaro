import React from 'react';
import type { Metadata } from 'next';
import { constructMetadata } from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'Settings & Preferences | MUXARO',
  description: 'Configure theme, default download quality, container format, audio format, and custom worker preferences.',
  path: '/settings',
  noIndex: true,
});

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
