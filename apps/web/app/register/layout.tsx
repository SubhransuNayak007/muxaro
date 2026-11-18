import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create free account — MUXARO',
  robots: {
    index: false,
    follow: false,
  },
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
