import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account — MUXARO',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
