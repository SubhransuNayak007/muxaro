'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Search } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { EcoModeToggle } from '@/components/EcoModeToggle';
import { ALL_STUDIO_TOOLS } from '@/lib/tools-catalog';

const NAV_LINKS = [
  { href: '/', label: 'Studio' },
  { href: '/ai', label: 'AI Studio' },
  { href: '/tools', label: 'All tools' },
  { href: '/tools/pdf', label: 'PDF' },
  { href: '/downloads', label: 'Downloads' },
  { href: '/docs', label: 'Docs' },
  { href: '/settings', label: 'Settings' },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const [mounted, setMounted] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const linkRefs = useRef<{ [href: string]: HTMLAnchorElement | null }>({});
  const [sliderStyle, setSliderStyle] = useState<{
    left: number;
    width: number;
    opacity: number;
  }>({ left: 0, width: 0, opacity: 0 });
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const [hasPositioned, setHasPositioned] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [mobileMenuOpen]);

  const isLinkActive = useCallback(
    (href: string) => {
      if (href === '/') return pathname === '/';
      if (href === '/tools') {
        return pathname === '/tools' || (pathname.startsWith('/tools/') && !pathname.startsWith('/tools/pdf'));
      }
      return pathname === href || pathname.startsWith(`${href}/`);
    },
    [pathname]
  );

  const updateSlider = useCallback(
    (overrideHref?: string | null) => {
      const activeItem = NAV_LINKS.find((item) => isLinkActive(item.href));
      const effectiveHref =
        overrideHref !== undefined && overrideHref !== null
          ? overrideHref
          : activeItem
          ? activeItem.href
          : null;

      if (!effectiveHref) {
        setSliderStyle((prev) => ({ ...prev, opacity: 0 }));
        return;
      }

      const targetEl = linkRefs.current[effectiveHref];
      if (targetEl) {
        setSliderStyle({
          left: targetEl.offsetLeft,
          width: targetEl.offsetWidth,
          opacity: 1,
        });
        setHasPositioned(true);
      }
    },
    [isLinkActive]
  );

  useEffect(() => {
    if (!mounted) return;
    updateSlider();
    const timer = setTimeout(() => updateSlider(), 50);
    return () => clearTimeout(timer);
  }, [pathname, mounted, updateSlider]);

  useEffect(() => {
    if (!mounted) return;
    const handleResize = () => updateSlider();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mounted, updateSlider]);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 w-full border-b border-line bg-surface/80 backdrop-blur-xl transition-colors"
    >
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
        {/* Left: Editorial Wordmark + Geometric Mark */}
        <div className="flex items-center shrink-0">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus group"
            aria-label="MUXARO Home"
          >
            <svg
              viewBox="0 0 32 32"
              fill="none"
              className="w-6 h-6 text-content shrink-0 transition-colors"
              aria-hidden="true"
            >
              <rect x="3" y="6" width="3" height="20" fill="currentColor" />
              <rect x="26" y="6" width="3" height="20" fill="currentColor" />
              <polygon points="3,6 16,20 29,6 29,10 16,26 3,10" fill="currentColor" />
              <line x1="3" y1="29" x2="29" y2="29" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="font-display font-medium text-xl tracking-[-0.02em] text-content">
              MUXARO
            </span>
          </Link>
        </div>

        {/* Center: Clean Segmented Navigation (Desktop) */}
        <nav
          aria-label="Main navigation"
          onMouseLeave={() => {
            setHoveredHref(null);
            updateSlider(null);
          }}
          className="hidden lg:flex items-center relative p-1 rounded-full bg-surface-elevated border border-line"
        >
          {sliderStyle.opacity > 0 && (
            <div
              aria-hidden="true"
              className={`absolute top-1 bottom-1 left-0 rounded-full bg-surface border border-line pointer-events-none origin-left ${
                hasPositioned ? 'transition-[transform,opacity] duration-200 ease-out' : ''
              }`}
              style={{
                width: '100px',
                transform: `translate3d(${sliderStyle.left}px, 0, 0) scaleX(${Math.max(0.01, sliderStyle.width / 100)})`,
                opacity: sliderStyle.opacity,
              }}
            />
          )}

          {NAV_LINKS.map((link) => {
            const active = isLinkActive(link.href);
            const isHovered = hoveredHref === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                ref={(el) => {
                  linkRefs.current[link.href] = el;
                }}
                onMouseEnter={() => {
                  setHoveredHref(link.href);
                  updateSlider(link.href);
                }}
                aria-current={active ? 'page' : undefined}
                className={`relative z-10 px-3.5 py-1.5 text-sm font-medium rounded-full transition-colors whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  active || isHovered
                    ? 'text-content font-semibold'
                    : 'text-content-secondary hover:text-content'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Cmd+K Quick Search, Eco Mode & Theme Switcher */}
        <div className="flex items-center gap-2 shrink-0 min-h-[36px]">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('muxaro:open-command'))}
            className="hidden sm:inline-flex items-center gap-2 px-3 h-9 rounded-full border border-line bg-surface-elevated hover:border-line-hover transition-colors text-xs text-content-secondary hover:text-content whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            title={`Search all ${ALL_STUDIO_TOOLS.length} Video and PDF tools or drop any file (Ctrl/Cmd + K)`}
            aria-label="Search tools or open command palette"
          >
            <Search className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden lg:inline">Search {ALL_STUDIO_TOOLS.length} tools</span>
            <span className="inline-flex items-center gap-0.5">
              <kbd className="font-mono text-[10px] min-w-[20px] h-5 px-1 inline-flex items-center justify-center rounded bg-surface border border-line">
                ⌘
              </kbd>
              <kbd className="font-mono text-[10px] min-w-[20px] h-5 px-1 inline-flex items-center justify-center rounded bg-surface border border-line">
                K
              </kbd>
            </span>
          </button>

          <EcoModeToggle className="hidden sm:inline-flex" />
          <ThemeToggle />

          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-drawer"
            className="w-9 h-9 shrink-0 flex items-center justify-center lg:hidden rounded-lg border border-line bg-surface text-content hover:bg-surface-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5" aria-hidden="true" />
            ) : (
              <Menu className="w-5 h-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-drawer"
          className="lg:hidden border-t border-line bg-surface px-4 py-4 space-y-3 shadow-elevated"
        >
          <nav aria-label="Mobile navigation" className="flex flex-col space-y-1">
            {NAV_LINKS.map((link) => {
              const active = isLinkActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    active
                      ? 'text-content bg-surface-elevated font-semibold'
                      : 'text-content-secondary hover:text-content hover:bg-surface-muted'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="pt-3 border-t border-line flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                window.dispatchEvent(new CustomEvent('muxaro:open-command'));
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-line bg-surface-elevated text-xs font-medium text-content"
            >
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Search all {ALL_STUDIO_TOOLS.length} tools</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
