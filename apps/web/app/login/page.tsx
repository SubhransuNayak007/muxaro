'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Mail,
  Lock,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  KeyRound,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { trackEvent } from '@/lib/analytics';

function sanitizeReturnTo(raw: string | null): string {
  if (!raw) return '/';
  const trimmed = raw.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  return '/';
}

function GoogleGlyph() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.48-1.7 4.35-5.27 4.35-3.17 0-5.76-2.63-5.76-5.88s2.59-5.88 5.76-5.88c1.81 0 3.02.77 3.71 1.43l2.53-2.44C16.79 4.14 14.69 3.2 12.17 3.2 7.21 3.2 3.2 7.21 3.2 12.17s4.01 8.97 8.97 8.97c5.18 0 8.61-3.64 8.61-8.77 0-.59-.07-1.04-.15-1.27z"
      />
    </svg>
  );
}

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { googleAuthConfigured, loading: authLoading, refreshSession } = useAuth();

  const safeReturnTo = sanitizeReturnTo(searchParams.get('returnTo'));
  const verifiedParam = searchParams.get('verified') === '1';
  const resetParam = searchParams.get('reset') === '1';
  const oauthErrorParam = searchParams.get('error');

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [mfaRequired, setMfaRequired] = useState<boolean>(false);
  const [mfaCode, setMfaCode] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    oauthErrorParam ? 'Sign-in could not be completed. Please try again.' : null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMessage('Please enter your email and password.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await api.login({
        email: trimmedEmail,
        password,
        mfaCode: mfaRequired ? mfaCode.trim() : undefined,
      });

      if (result.mfaRequired && !result.authenticated) {
        setMfaRequired(true);
        setSubmitting(false);
        return;
      }

      if (mfaRequired && mfaCode.trim() && result.mfaRequired) {
        await api.verifyMfa(mfaCode.trim());
      }

      trackEvent('auth_login_completed', { method: 'email' });
      await refreshSession();
      router.push(safeReturnTo);
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : '';
      if (rawMessage.toLowerCase().includes('mfa') || rawMessage.toLowerCase().includes('two-factor')) {
        setMfaRequired(true);
        setErrorMessage(rawMessage || 'Please enter your six-digit authenticator code.');
      } else {
        setErrorMessage(rawMessage || 'Invalid email or password.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const googleHref = `/api/v1/auth/google/start?returnTo=${encodeURIComponent(safeReturnTo)}`;
  const registerHref =
    safeReturnTo === '/'
      ? '/register'
      : `/register?returnTo=${encodeURIComponent(safeReturnTo)}`;

  return (
    <section className="muxaro-hero-surface w-full py-12 sm:py-16">
      <div className="max-w-md mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-content tracking-tight mb-2">
            Sign in to Muxaro
          </h1>
          <p className="text-sm sm:text-base text-content-secondary">
            Access your downloads, saved history, and member priority.
          </p>
        </div>

        <div className="rounded-2xl shadow-lg bg-surface border border-line p-6 sm:p-8 space-y-6">
          {verifiedParam && (
            <div
              role="status"
              className="p-3.5 rounded-xl bg-success-bg border border-success text-success text-sm flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>Your email is verified. Sign in below to continue.</span>
            </div>
          )}

          {resetParam && (
            <div
              role="status"
              className="p-3.5 rounded-xl bg-success-bg border border-success text-success text-sm flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>Your password has been updated. Sign in with your new password.</span>
            </div>
          )}

          {/* Google Sign-In (only active when genuinely configured on server) */}
          {googleAuthConfigured ? (
            <a
              href={googleHref}
              onClick={() => trackEvent('auth_google_started', { source: 'login' })}
              className="w-full px-4 py-3 rounded-xl border border-line bg-base text-content font-semibold text-sm inline-flex items-center justify-center gap-2.5 hover:border-brand-violet active:translate-y-px transition-colors duration-150 whitespace-nowrap"
            >
              <GoogleGlyph />
              <span>Continue with Google</span>
            </a>
          ) : (
            !authLoading && (
              <div className="px-4 py-3 rounded-xl border border-line bg-elevated text-content-secondary text-xs text-center">
                Google sign-in is currently unavailable on this server. Sign in with email below.
              </div>
            )
          )}

          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-line" aria-hidden="true" />
            <span className="bg-surface px-3 text-xs text-content-secondary whitespace-nowrap">
              Or continue with email
            </span>
            <div className="w-full border-t border-line" aria-hidden="true" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-content mb-1.5">
                Email address
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label htmlFor="login-password" className="block text-sm font-medium text-content">
                  Password
                </label>
                <Link
                  href="/reset-password"
                  className="text-xs font-medium text-brand-violet dark:text-content hover:underline whitespace-nowrap"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock
                  className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                />
              </div>
            </div>

            {mfaRequired && (
              <div>
                <label htmlFor="login-mfa" className="block text-sm font-medium text-content mb-1.5">
                  Authenticator code
                </label>
                <div className="relative">
                  <KeyRound
                    className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="login-mfa"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                  />
                </div>
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-error-bg border border-error text-error text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              aria-disabled={submitting}
              className="muxaro-btn-primary w-full py-3 px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 active:translate-y-px disabled:opacity-70 whitespace-nowrap"
            >
              {submitting && (
                <Loader2 className="w-4 h-4 motion-safe:animate-spin shrink-0" aria-hidden="true" />
              )}
              <span className="whitespace-nowrap">
                {submitting ? 'Signing in…' : 'Sign in'}
              </span>
            </button>
          </form>

          <div className="pt-2 border-t border-line flex items-center justify-between gap-2 text-xs text-content-secondary">
            <span>New to Muxaro?</span>
            <Link
              href={registerHref}
              className="font-semibold text-brand-violet dark:text-content hover:underline whitespace-nowrap"
            >
              Create free account
            </Link>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-content-secondary inline-flex items-center justify-center gap-1.5 w-full">
          <ShieldCheck className="w-4 h-4 text-brand-violet shrink-0" aria-hidden="true" />
          <span>Protected by secure session cookies and automatic file expiry.</span>
        </p>
      </div>
    </section>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto px-4 py-16 text-center text-sm text-content-secondary">
          Loading sign-in…
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
