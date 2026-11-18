import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Usage & Daily Limits — MUXARO',
  robots: {
    index: false,
    follow: false,
  },
};

export default function CreditsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
