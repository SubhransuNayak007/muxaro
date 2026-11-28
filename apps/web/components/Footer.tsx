import React from 'react';
import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-line bg-surface transition-colors mt-16">
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8">
          <div className="space-y-2.5 sm:col-span-2 md:col-span-1">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus w-fit"
              aria-label="MUXARO Home"
            >
              <svg
                viewBox="0 0 32 32"
                fill="none"
                className="w-5 h-5 text-content shrink-0"
                aria-hidden="true"
              >
                <rect x="3" y="6" width="3" height="20" fill="currentColor" />
                <rect x="26" y="6" width="3" height="20" fill="currentColor" />
                <polygon points="3,6 16,20 29,6 29,10 16,26 3,10" fill="currentColor" />
                <line x1="3" y1="29" x2="29" y2="29" stroke="currentColor" strokeWidth="1" />
              </svg>
              <span className="font-display font-medium text-base tracking-[-0.02em] text-content">
                MUXARO
              </span>
            </Link>
            <p className="text-xs text-content-secondary leading-relaxed max-w-xs">
              Local PDF, media, and AI tools built for privacy.
            </p>
          </div>

          <nav aria-label="Workspace">
            <h3 className="text-xs font-semibold text-content mb-3">Workspace</h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link href="/ai" className="hover:text-content transition-colors rounded">
                  AI Studio
                </Link>
              </li>
              <li>
                <Link href="/tools?section=video" className="hover:text-content transition-colors rounded">
                  Video Studio
                </Link>
              </li>
              <li>
                <Link href="/tools/pdf" className="hover:text-content transition-colors rounded">
                  PDF Studio
                </Link>
              </li>
              <li>
                <Link href="/downloads" className="hover:text-content transition-colors rounded">
                  Downloads
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Resources">
            <h3 className="text-xs font-semibold text-content mb-3">Resources</h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link href="/tools" className="hover:text-content transition-colors rounded">
                  All Tools
                </Link>
              </li>
              <li>
                <Link href="/docs" className="hover:text-content transition-colors rounded">
                  Documentation
                </Link>
              </li>
              <li>
                <Link href="/docs/security" className="hover:text-content transition-colors rounded">
                  Security
                </Link>
              </li>
              <li>
                <Link href="/settings" className="hover:text-content transition-colors rounded">
                  Settings
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Legal">
            <h3 className="text-xs font-semibold text-content mb-3">Legal</h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link href="/privacy" className="hover:text-content transition-colors rounded">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-content transition-colors rounded">
                  Terms
                </Link>
              </li>
              <li>
                <Link href="/dmca" className="hover:text-content transition-colors rounded">
                  DMCA
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-8 pt-5 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-content-secondary">
          <p>© {currentYear} MUXARO</p>
          <p>Browser WASM runs with zero uploads.</p>
        </div>
      </div>
    </footer>
  );
}
