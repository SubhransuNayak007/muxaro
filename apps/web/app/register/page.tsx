'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  User,
  Mail,
  Lock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
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

const MEMBER_BENEFITS = [
  'Save your processing history',
  'Continue jobs across sessions',
  'Priority processing for members',
  '10 daily jobs plus optional rewarded credits',
] as const;

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

function RegisterFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { googleAuthConfigured, loading: authLoading, refreshSession } = useAuth();

  const safeReturnTo = sanitizeReturnTo(searchParams.get('returnTo'));

  const [displayName, setDisplayName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMessage('Please enter your email and choose a password.');
      return;
    }
    if (password.length < 8) {
      setErrorMessage('Please choose a password with at least 8 characters.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    trackEvent('auth_signup_started', { method: 'email' });

    try {
      const result = await api.register({
        email: trimmedEmail,
        password,
        displayName: displayName.trim() || undefined,
      });

      trackEvent('auth_signup_completed', { method: 'email' });
      await refreshSession();

      if (result.verificationRequired) {
        const params = new URLSearchParams({
          email: trimmedEmail,
          returnTo: safeReturnTo,
        });
        router.push(`/verify-email?${params.toString()}`);
      } else {
        router.push(safeReturnTo);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'We could not create your account right now. Please try again.';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  const googleHref = `/api/v1/auth/google/start?returnTo=${encodeURIComponent(safeReturnTo)}`;
  const loginHref =
    safeReturnTo === '/'
      ? '/login'
      : `/login?returnTo=${encodeURIComponent(safeReturnTo)}`;

  return (
    <section className="muxaro-hero-surface w-full py-12 sm:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Honest Member Benefits Column */}
          <div className="lg:col-span-5 lg:pt-6">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight leading-tight mb-3">
              Create your free account
            </h1>
            <p className="text-base text-content-secondary leading-relaxed mb-6">
              Keep your downloads organized with 10 daily media jobs.
            </p>

            <ul className="space-y-3.5 mb-6">
              {MEMBER_BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2.5 text-sm text-content">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>

            <p className="text-xs text-content-secondary inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-brand-violet shrink-0" aria-hidden="true" />
              <span>Free to join. Delete your account anytime.</span>
            </p>
          </div>

          {/* Registration Card */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl shadow-lg bg-surface border border-line p-6 sm:p-8 space-y-6">
              {googleAuthConfigured ? (
                <a
                  href={googleHref}
                  onClick={() => trackEvent('auth_google_started', { source: 'register' })}
                  className="w-full px-4 py-3 rounded-xl border border-line bg-base text-content font-semibold text-sm inline-flex items-center justify-center gap-2.5 hover:border-brand-violet active:translate-y-px transition-colors duration-150 whitespace-nowrap"
                >
                  <GoogleGlyph />
                  <span>Continue with Google</span>
                </a>
              ) : (
                !authLoading && (
                  <div className="px-4 py-3 rounded-xl border border-line bg-elevated text-content-secondary text-xs text-center">
                    Google sign-up is currently unavailable on this server. Register with email below.
                  </div>
                )
              )}

              <div className="relative flex items-center justify-center">
                <div className="w-full border-t border-line" aria-hidden="true" />
                <span className="bg-surface px-3 text-xs text-content-secondary whitespace-nowrap">
                  Or register with email
                </span>
                <div className="w-full border-t border-line" aria-hidden="true" />
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="register-name" className="block text-sm font-medium text-content mb-1.5">
                    Display name (optional)
                  </label>
                  <div className="relative">
                    <User
                      className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="register-name"
                      type="text"
                      autoComplete="name"
                      maxLength={80}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Alex Morgan"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-email" className="block text-sm font-medium text-content mb-1.5">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail
                      className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="register-email"
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
                  <label htmlFor="register-password" className="block text-sm font-medium text-content mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="register-password"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-content-secondary">
                    Use at least 8 characters with letters and numbers.
                  </p>
                </div>

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
                    {submitting ? 'Creating account…' : 'Create free account'}
                  </span>
                </button>
              </form>

              <div className="pt-2 border-t border-line flex items-center justify-between gap-2 text-xs text-content-secondary">
                <span>Already have an account?</span>
                <Link
                  href={loginHref}
                  className="font-semibold text-brand-violet dark:text-content hover:underline whitespace-nowrap"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto px-4 py-16 text-center text-sm text-content-secondary">
          Loading registration…
        </div>
      }
    >
      <RegisterFormContent />
    </Suspense>
  );
}
