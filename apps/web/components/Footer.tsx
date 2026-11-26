import React from 'react';
import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-line bg-surface transition-colors mt-20">
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
          {/* Column 1: Brand Identity & Summary */}
          <div className="space-y-3 sm:col-span-2 md:col-span-1">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus w-fit"
              aria-label="MUXARO Home"
            >
              <svg
                viewBox="0 0 32 32"
                fill="none"
                className="w-6 h-6 text-content shrink-0"
                aria-hidden="true"
              >
                <rect x="3" y="6" width="3" height="20" fill="currentColor" />
                <rect x="26" y="6" width="3" height="20" fill="currentColor" />
                <polygon points="3,6 16,20 29,6 29,10 16,26 3,10" fill="currentColor" />
                <line x1="3" y1="29" x2="29" y2="29" stroke="currentColor" strokeWidth="1" />
              </svg>
              <span className="font-display font-medium text-lg tracking-[-0.02em] text-content">
                MUXARO
              </span>
            </Link>
            <p className="text-xs text-content-secondary leading-relaxed max-w-xs">
              All-in-one video, PDF, and media workstation. Browser-local WASM execution paired with ephemeral FFmpeg processing and zero ads.
            </p>
          </div>

          {/* Column 2: Suites */}
          <nav aria-label="Studio suites">
            <h3 className="text-xs font-semibold text-content mb-3.5">
              Suites
            </h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link href="/" className="hover:text-content transition-colors rounded">
                  Stream Downloader
                </Link>
              </li>
              <li>
                <Link href="/tools?section=video" className="hover:text-content transition-colors rounded">
                  Video Studio (14)
                </Link>
              </li>
              <li>
                <Link href="/tools/pdf" className="hover:text-content transition-colors rounded">
                  PDF Studio (38)
                </Link>
              </li>
              <li>
                <Link href="/tools?section=audio" className="hover:text-content transition-colors rounded">
                  Audio Studio (Roadmap)
                </Link>
              </li>
              <li>
                <Link href="/downloads" className="hover:text-content transition-colors rounded">
                  Downloads
                </Link>
              </li>
            </ul>
          </nav>

          {/* Column 3: Documentation */}
          <nav aria-label="Documentation links">
            <h3 className="text-xs font-semibold text-content mb-3.5">
              Documentation
            </h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link href="/docs" className="hover:text-content transition-colors rounded">
                  All Guides
                </Link>
              </li>
              <li>
                <Link href="/docs/video-studio" className="hover:text-content transition-colors rounded">
                  Video Studio Guide
                </Link>
              </li>
              <li>
                <Link href="/docs/pdf-studio" className="hover:text-content transition-colors rounded">
                  PDF Studio Guide
                </Link>
              </li>
              <li>
                <Link href="/docs/audio-studio" className="hover:text-content transition-colors rounded">
                  Audio Studio Roadmap
                </Link>
              </li>
              <li>
                <Link href="/docs/formats" className="hover:text-content transition-colors rounded">
                  Formats &amp; Codecs
                </Link>
              </li>
            </ul>
          </nav>

          {/* Column 4: Security & Legal */}
          <nav aria-label="Security and legal links">
            <h3 className="text-xs font-semibold text-content mb-3.5">
              Security &amp; Legal
            </h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link href="/docs/security" className="hover:text-content transition-colors rounded">
                  Trust &amp; Security
                </Link>
              </li>
              <li>
                <Link href="/docs/faq" className="hover:text-content transition-colors rounded">
                  Frequently Asked Questions
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-content transition-colors rounded">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-content transition-colors rounded">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/dmca" className="hover:text-content transition-colors rounded">
                  DMCA Notice
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-content-secondary">
          <p>© {currentYear} MUXARO</p>
          <p>PDF tools run 100% locally in your browser; temporary worker files purge after 60 minutes.</p>
        </div>
      </div>
    </footer>
  );
}
