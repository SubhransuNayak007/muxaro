'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sun,
  Moon,
  Menu,
  X,
  Zap,
  Feather,
  User,
  Download,
  LogOut,
  Shield,
  ChevronDown,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { QuotaStatus } from '@/lib/types';
import { useDeviceMode } from '@/lib/device-mode';
import { useAuth } from '@/lib/auth-context';

type QuotaLoadState = 'loading' | 'loaded' | 'error';

interface LiveQuotaSummary {
  available: number;
  baseLimit: number;
  extraRemaining: number;
}

function getUserInitials(displayName: string | null, email: string, publicUserId: string): string {
  const name = (displayName || '').trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  const cleanEmail = (email || '').trim();
  if (cleanEmail) {
    return cleanEmail.slice(0, 2).toUpperCase();
  }
  const suffix = (publicUserId || '').replace(/^MXR-/i, '').trim();
  return (suffix.slice(0, 2) || 'MX').toUpperCase();
}

function isSafeAvatarUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('/');
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  const { lightweight, manualLightweight, toggleLightweight } = useDeviceMode();
  const { user, authenticated, loading: authLoading, logout } = useAuth();

  const [quota, setQuota] = useState<LiveQuotaSummary | null>(null);
  const [quotaState, setQuotaState] = useState<QuotaLoadState>('loading');
  const [isDark, setIsDark] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState<boolean>(false);
  const [signingOut, setSigningOut] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
    const isDarkMode =
      document.documentElement.classList.contains('dark') ||
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      localStorage.getItem('theme') === 'dark';
    setIsDark(isDarkMode);
  }, []);

  // Fetch live credits whenever auth state changes (never invent fallback numbers)
  useEffect(() => {
    let isMounted = true;
    setQuotaState('loading');

    api
      .getQuota()
      .then((q: QuotaStatus | null) => {
        if (!isMounted) return;
        if (!q) {
          setQuota(null);
          setQuotaState('error');
          return;
        }
        const available =
          typeof q.totalAvailableIndividual === 'number' &&
          Number.isFinite(q.totalAvailableIndividual)
            ? q.totalAvailableIndividual
            : typeof q.individualVideosRemaining === 'number' &&
              Number.isFinite(q.individualVideosRemaining)
            ? q.individualVideosRemaining
            : null;
        const baseLimit =
          typeof q.baseLimit === 'number' && Number.isFinite(q.baseLimit) && q.baseLimit > 0
            ? q.baseLimit
            : typeof q.individualVideosLimit === 'number' &&
              Number.isFinite(q.individualVideosLimit) &&
              q.individualVideosLimit > 0
            ? q.individualVideosLimit
            : null;
        const extraRemaining =
          typeof q.extraCreditsRemaining === 'number' &&
          Number.isFinite(q.extraCreditsRemaining) &&
          q.extraCreditsRemaining > 0
            ? q.extraCreditsRemaining
            : 0;

        if (available !== null && baseLimit !== null) {
          setQuota({ available, baseLimit, extraRemaining });
          setQuotaState('loaded');
        } else {
          setQuota(null);
          setQuotaState('error');
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setQuota(null);
        setQuotaState('error');
      });

    return () => {
      isMounted = false;
    };
  }, [authenticated, user?.publicUserId]);

  // Theme toggle with class, attribute, and storage synchronization
  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
      }
      return next;
    });
  }, []);

  // Close menus on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setAccountMenuOpen(false);
  }, [pathname]);

  // Close menus on Escape key (returning focus) or outside pointerdown
  useEffect(() => {
    if (!mobileMenuOpen && !accountMenuOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (accountMenuOpen) {
          setAccountMenuOpen(false);
          accountButtonRef.current?.focus();
        }
        if (mobileMenuOpen) {
          setMobileMenuOpen(false);
          menuButtonRef.current?.focus();
        }
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
        setAccountMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [mobileMenuOpen, accountMenuOpen]);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      setAccountMenuOpen(false);
      setMobileMenuOpen(false);
      if (pathname === '/account' || pathname === '/admin') {
        router.push('/');
      }
    } finally {
      setSigningOut(false);
    }
  }, [logout, pathname, router, signingOut]);

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/tools', label: 'Tools' },
    { href: '/dashboard', label: 'My Downloads' },
    { href: '/credits', label: 'Usage' },
    { href: '/account', label: 'Account' },
  ];

  const isLinkActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const isLightweightActive = mounted && lightweight;
  const lightweightLabel = isLightweightActive
    ? manualLightweight
      ? 'Disable lightweight mode'
      : 'Lightweight mode active (system or network preference)'
    : 'Enable lightweight mode';

  const isAdmin = Boolean(authenticated && user && user.role === 'admin');
  const userInitials = user
    ? getUserInitials(user.displayName, user.email, user.publicUserId)
    : 'MX';

  const creditsDisplay =
    quotaState === 'loaded' && quota
      ? quota.extraRemaining > 0
        ? `${quota.available} credits`
        : `${quota.available}/${quota.baseLimit}`
      : null;

  const creditsAriaLabel =
    quotaState === 'loaded' && quota
      ? `Available credits: ${quota.available} daily jobs remaining`
      : 'View daily usage and credits';

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 w-full border-b border-line/70 bg-surface/85 backdrop-blur-md shadow-sm transition-colors"
    >
      <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Left: Brand Identity */}
        <div className="flex items-center shrink-0">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            aria-label="MUXARO Home"
          >
            <img
              src="/brand/muxaro-mark.svg"
              alt=""
              width={28}
              height={28}
              className="w-7 h-7 object-contain"
            />
            <span className="font-sans font-extrabold text-xl tracking-tight text-content">
              MUXARO
            </span>
          </Link>
        </div>

        {/* Center: Google Antigravity Floating Pill Navigation (Desktop) */}
        <nav
          className="hidden lg:flex items-center gap-1 px-1.5 py-1 rounded-full bg-surface-elevated/80 border border-line/60 shadow-xs"
          aria-label="Main navigation"
        >
          {navLinks.map((item) => {
            const active = isLinkActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`px-3.5 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                  active
                    ? 'text-brand-violet dark:text-content bg-surface shadow-xs font-semibold'
                    : 'text-content-secondary hover:text-content hover:bg-surface/50'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Auth Controls, Live Credits, Lightweight Mode & Theme Switcher */}
        <div className="flex items-center gap-2">
          {/* Signed-in: Live Credits Badge + Account Menu */}
          {mounted && authenticated && user ? (
            <>
              <Link
                href="/credits"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line bg-surface-muted hover:border-brand-violet transition-colors active:opacity-90 text-xs whitespace-nowrap group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                title="View your available credits and daily limits"
                aria-label={creditsAriaLabel}
              >
                <Zap className="w-3.5 h-3.5 text-brand-violet shrink-0" aria-hidden="true" />
                {creditsDisplay ? (
                  <span className="font-semibold text-content tabular-nums group-hover:text-brand-violet transition-colors">
                    {creditsDisplay}
                  </span>
                ) : quotaState === 'loading' ? (
                  <span
                    className="inline-block h-3 w-9 rounded-full bg-surface-elevated"
                    aria-hidden="true"
                  />
                ) : (
                  <span className="font-medium text-content-secondary group-hover:text-content transition-colors">
                    Usage
                  </span>
                )}
              </Link>

              <div className="relative">
                <button
                  ref={accountButtonRef}
                  type="button"
                  onClick={() => setAccountMenuOpen((prev) => !prev)}
                  aria-expanded={accountMenuOpen}
                  aria-haspopup="menu"
                  aria-controls="navbar-account-menu"
                  aria-label={`Account menu for ${user.publicUserId}`}
                  className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border border-line bg-surface hover:bg-surface-muted hover:border-brand-violet transition-colors active:opacity-90 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  {isSafeAvatarUrl(user.avatarUrl) ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      width={26}
                      height={26}
                      className="w-6 h-6 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-info-bg text-brand-violet dark:text-content text-xs font-semibold shrink-0"
                      aria-hidden="true"
                    >
                      {userInitials}
                    </span>
                  )}
                  <span className="hidden sm:inline text-xs font-semibold text-content font-mono">
                    {user.publicUserId}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-content-secondary transition-transform ${
                      accountMenuOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {accountMenuOpen && (
                  <div
                    id="navbar-account-menu"
                    role="menu"
                    aria-label="Account menu"
                    className="absolute right-0 mt-2 w-60 rounded-lg border border-line bg-surface shadow-lg py-1.5 z-50"
                  >
                    <div className="px-3.5 py-2.5 border-b border-line">
                      <p className="text-sm font-semibold text-content truncate">
                        {user.displayName || user.email || 'Account'}
                      </p>
                      <p className="text-xs font-mono text-content-secondary mt-0.5 truncate">
                        {user.publicUserId}
                      </p>
                    </div>

                    <div className="py-1">
                      <Link
                        href="/account"
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-content-secondary hover:text-content hover:bg-surface-muted transition-colors focus-visible:outline-none focus-visible:bg-surface-muted focus-visible:text-content"
                      >
                        <User className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Account</span>
                      </Link>
                      <Link
                        href="/dashboard"
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-content-secondary hover:text-content hover:bg-surface-muted transition-colors focus-visible:outline-none focus-visible:bg-surface-muted focus-visible:text-content"
                      >
                        <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>My Downloads</span>
                      </Link>
                      <Link
                        href="/credits"
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className="flex items-center justify-between gap-2.5 px-3.5 py-2 text-sm text-content-secondary hover:text-content hover:bg-surface-muted transition-colors focus-visible:outline-none focus-visible:bg-surface-muted focus-visible:text-content"
                      >
                        <span className="flex items-center gap-2.5">
                          <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>Usage</span>
                        </span>
                        {creditsDisplay && (
                          <span className="text-xs font-semibold text-content tabular-nums">
                            {creditsDisplay}
                          </span>
                        )}
                      </Link>
                      {isAdmin && (
                        <Link
                          href="/admin"
                          role="menuitem"
                          onClick={() => setAccountMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-content-secondary hover:text-content hover:bg-surface-muted transition-colors focus-visible:outline-none focus-visible:bg-surface-muted focus-visible:text-content"
                        >
                          <Shield className="w-4 h-4 shrink-0 text-brand-violet" aria-hidden="true" />
                          <span>Admin</span>
                        </Link>
                      )}
                    </div>

                    <div className="pt-1 border-t border-line">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={signingOut}
                        onClick={handleSignOut}
                        className="flex items-center gap-2.5 w-full px-3.5 py-2 text-sm text-content-secondary hover:text-error hover:bg-error-bg transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:bg-error-bg focus-visible:text-error"
                      >
                        <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : !mounted || authLoading ? (
            <span
              className="hidden sm:inline-block h-8 w-24 rounded-full bg-surface-muted"
              aria-hidden="true"
            />
          ) : (
            /* Signed-out: Clean Sign in + Create free account buttons */
            <div className="hidden sm:flex items-center gap-2">
              <Link
                href="/login"
                className="px-3 py-1.5 text-sm font-medium rounded-lg text-content-secondary hover:text-content hover:bg-surface-muted transition-colors active:opacity-90 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="px-3.5 py-1.5 text-xs font-semibold rounded-full muxaro-btn-primary whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Create free account
              </Link>
            </div>
          )}

          {/* Lightweight Mode Toggle (reduces animations for older devices & slow networks) */}
          <button
            type="button"
            onClick={toggleLightweight}
            title="Lightweight mode: reduces animations for older devices & slow networks"
            aria-label={lightweightLabel}
            aria-pressed={mounted ? isLightweightActive : undefined}
            className={`p-2 rounded-lg border transition-colors active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
              isLightweightActive
                ? 'border-brand-violet bg-info-bg text-brand-violet dark:text-content'
                : 'border-line bg-surface hover:bg-surface-muted text-content-secondary hover:text-content'
            }`}
          >
            <Feather className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* Theme Switcher Button */}
          <button
            type="button"
            onClick={toggleTheme}
            title={mounted && isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={mounted && isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-pressed={mounted ? isDark : undefined}
            className="p-2 rounded-lg border border-line bg-surface hover:bg-surface-muted text-content-secondary hover:text-content transition-colors active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {mounted && isDark ? (
              <Sun className="w-4 h-4 text-warning" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4 text-content-secondary" aria-hidden="true" />
            )}
          </button>

          {/* Mobile Menu Button */}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-drawer"
            className="lg:hidden p-2 rounded-lg border border-line bg-surface text-content hover:bg-surface-muted transition-colors active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5" aria-hidden="true" />
            ) : (
              <Menu className="w-5 h-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-drawer"
          className="lg:hidden border-t border-line bg-surface px-4 py-4 space-y-3 shadow-md"
        >
          <nav className="flex flex-col space-y-1" aria-label="Mobile navigation">
            {navLinks.map((item) => {
              const active = isLinkActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                    active
                      ? 'text-brand-violet dark:text-content bg-info-bg font-semibold'
                      : 'text-content-secondary hover:text-content hover:bg-surface-muted'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => setMobileMenuOpen(false)}
                aria-current={pathname === '/admin' ? 'page' : undefined}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                  pathname === '/admin'
                    ? 'text-brand-violet dark:text-content bg-info-bg font-semibold'
                    : 'text-content-secondary hover:text-content hover:bg-surface-muted'
                }`}
              >
                <Shield className="w-4 h-4 text-brand-violet" aria-hidden="true" />
                <span>Admin</span>
              </Link>
            )}
          </nav>

          {/* Mobile Auth & Account Section */}
          <div className="pt-3 border-t border-line space-y-2.5">
            {mounted && authenticated && user ? (
              <>
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isSafeAvatarUrl(user.avatarUrl) ? (
                      <img
                        src={user.avatarUrl}
                        alt=""
                        width={28}
                        height={28}
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <span
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-info-bg text-brand-violet dark:text-content text-xs font-semibold shrink-0"
                        aria-hidden="true"
                      >
                        {userInitials}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-content truncate">
                        {user.displayName || user.email || 'Signed in'}
                      </p>
                      <p className="text-xs font-mono text-content-secondary truncate">
                        {user.publicUserId}
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/credits"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line bg-surface-muted text-xs font-medium text-content hover:text-brand-violet transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    <Zap className="w-3 h-3 text-brand-violet" aria-hidden="true" />
                    <span className="tabular-nums font-semibold">
                      {creditsDisplay || 'Usage'}
                    </span>
                  </Link>
                </div>

                <button
                  type="button"
                  disabled={signingOut}
                  onClick={handleSignOut}
                  className="flex items-center justify-center gap-2 w-full py-2 px-4 rounded-lg border border-line bg-surface text-sm font-medium text-content-secondary hover:text-error hover:border-error hover:bg-error-bg transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                  <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>
                </button>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center py-2 px-3 rounded-lg border border-line bg-surface text-sm font-medium text-content hover:bg-surface-muted transition-colors active:opacity-90 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center py-2 px-3 rounded-full muxaro-btn-primary text-xs font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  Create free account
                </Link>
              </div>
            )}

            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-xs font-medium text-content-secondary">Lightweight mode</span>
              <button
                type="button"
                onClick={toggleLightweight}
                aria-pressed={mounted ? isLightweightActive : undefined}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors active:opacity-90 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                  isLightweightActive
                    ? 'border-brand-violet bg-info-bg text-brand-violet dark:text-content'
                    : 'border-line bg-surface-muted text-content-secondary hover:text-content'
                }`}
              >
                <Feather className="w-3 h-3" aria-hidden="true" />
                <span>{isLightweightActive ? 'On' : 'Off'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
