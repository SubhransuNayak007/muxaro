import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Downloads & Workspace — MUXARO',
  alternates: {
    canonical: '/dashboard',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
