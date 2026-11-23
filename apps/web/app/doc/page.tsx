import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Documentation — MUXARO',
  description: 'Official API documentation, architecture guides, and media processing engine specifications.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://muxaro.app/docs' },
};

/**
 * Direct shortcut route /doc -> redirects to canonical /docs
 */
export default function DocShortcutPage() {
  redirect('/docs');
}
