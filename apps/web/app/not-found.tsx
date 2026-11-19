import React from 'react';
import Link from 'next/link';
import { Home, Compass } from 'lucide-react';

export const metadata = {
  title: '404 - Page Not Found — MUXARO',
  description: 'The requested page could not be found.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold text-content tracking-tight">
            Page not found (404)
          </h1>
          <p className="text-sm text-content-secondary leading-relaxed">
            The page you are looking for does not exist or has been moved to another location.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-surface-inverted text-surface font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            <span>Go to workspace</span>
          </Link>
          <Link
            href="/tools"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-line bg-surface text-content font-semibold text-sm hover:bg-surface-muted transition-colors"
          >
            <Compass className="w-4 h-4" aria-hidden="true" />
            <span>Explore tools</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
