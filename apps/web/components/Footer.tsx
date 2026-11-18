import React from 'react';
import Link from 'next/link';
import { Activity } from 'lucide-react';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-line bg-surface transition-colors mt-20">
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand Identity & Summary */}
          <div className="space-y-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface w-fit"
              aria-label="MUXARO Home"
            >
              <img
                src="/brand/muxaro-mark.svg"
                alt=""
                width={24}
                height={24}
                className="w-6 h-6 object-contain"
              />
              <span className="font-sans font-extrabold text-lg tracking-tight text-content">
                MUXARO
              </span>
            </Link>
            <p className="text-xs text-content-secondary leading-relaxed max-w-xs">
              Your media, one powerful workspace. Fast, private video conversion, audio extraction, and track merging.
            </p>
            <div className="pt-1">
              <Link
                href="/status"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-line bg-surface-muted text-content-secondary hover:text-content hover:border-brand-violet transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Activity className="w-3.5 h-3.5 text-brand-violet" aria-hidden="true" />
                <span>Service status</span>
              </Link>
            </div>
          </div>

          {/* Product Links */}
          <nav aria-label="Product links">
            <h3 className="text-xs font-semibold text-content mb-3.5">
              Product
            </h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link
                  href="/"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Home
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
                  href="/dashboard"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  My Downloads
                </Link>
              </li>
              <li>
                <Link
                  href="/credits"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Usage & Limits
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

          {/* Documentation & Formats */}
          <nav aria-label="Documentation links">
            <h3 className="text-xs font-semibold text-content mb-3.5">
              Resources
            </h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link
                  href="/docs"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Docs
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/formats"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Formats
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/audio-quality"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Audio quality guide
                </Link>
              </li>
              <li>
                <Link
                  href="/docs/faq"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  FAQ
                </Link>
              </li>
            </ul>
          </nav>

          {/* Legal & Status */}
          <nav aria-label="Legal links">
            <h3 className="text-xs font-semibold text-content mb-3.5">
              Legal
            </h3>
            <ul className="space-y-2 text-xs text-content-secondary">
              <li>
                <Link
                  href="/privacy"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Privacy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Terms
                </Link>
              </li>
              <li>
                <Link
                  href="/dmca"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  DMCA
                </Link>
              </li>
              <li>
                <Link
                  href="/status"
                  className="hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded"
                >
                  Service status
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-content-secondary">
          <p>© {currentYear} MUXARO</p>
          <p>Private, authorised media processing. Files auto-delete after 60 minutes.</p>
        </div>
      </div>
    </footer>
  );
}
