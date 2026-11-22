import React from 'react';
import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-line bg-surface transition-colors mt-20">
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8 lg:gap-12">
          {/* Column 1: Brand Identity & Summary */}
          <div className="space-y-3 sm:col-span-2 md:col-span-1">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface w-fit"
              aria-label="MUXARO Home"
            >
              <img
                src="/brand/muxaro-mark-mono.svg"
                alt=""
                width={24}
                height={24}
                className="w-6 h-6 object-contain text-content"
                style={{ color: 'currentColor', filter: 'none' }}
              />
              <span className="font-sans font-extrabold text-lg tracking-[-0.03em] text-content">
                MUXARO
              </span>
            </Link>
            <p className="text-xs text-content-secondary leading-relaxed max-w-xs">
              Fast, private media processing. Direct stream copy, audio extraction, and container remuxing with zero ads.
            </p>
          </div>

          {/* Column 2: Product */}
          <nav aria-label="Product links">
            <h3 className="text-xs font-semibold text-content uppercase tracking-wider mb-3.5">
              Product
            </h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link
                  href="/"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Downloader
                </Link>
              </li>
              <li>
                <Link
                  href="/tools"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Tools
                </Link>
              </li>
              <li>
                <Link
                  href="/downloads"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Downloads
                </Link>
              </li>
              <li>
                <Link
                  href="/credits"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Credits
                </Link>
              </li>
              <li>
                <Link
                  href="/account"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Account
                </Link>
              </li>
            </ul>
          </nav>

          {/* Column 3: Resources & Legal */}
          <nav aria-label="Resources and legal links">
            <h3 className="text-xs font-semibold text-content uppercase tracking-wider mb-3.5">
              Resources &amp; Legal
            </h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link
                  href="/docs"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Documentation
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/formats"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Formats &amp; Codecs
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/audio-quality"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Audio Quality Guide
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/dmca"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  DMCA Notice
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-content-secondary">
          <p>© {currentYear} MUXARO</p>
          <p>Files automatically delete after 60 minutes.</p>
        </div>
      </div>
    </footer>
  );
}
