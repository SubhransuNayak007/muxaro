'use client';

import React, { Suspense, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  MailCheck,
  KeyRound,
  Mail,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
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

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const { user, authenticated, refreshSession } = useAuth();

  const initialToken = (searchParams.get('token') || '').trim();
  const initialEmail = (searchParams.get('email') || '').trim();
  const safeReturnTo = sanitizeReturnTo(searchParams.get('returnTo'));

  const [codeOrToken, setCodeOrToken] = useState<string>(initialToken);
  const [email, setEmail] = useState<string>(initialEmail);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [resending, setResending] = useState<boolean>(false);
  const [verified, setVerified] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!email && user?.email) {
      setEmail(user.email);
    }
  }, [email, user?.email]);

  const submitVerification = useCallback(
    async (value: string, method: 'link' | 'code') => {
      const cleaned = value.trim();
      if (!cleaned) {
        setErrorMessage('Please enter your verification code or token.');
        return;
      }

      setSubmitting(true);
      setErrorMessage(null);
      setStatusMessage(null);

      try {
        const isSixDigitCode = /^\d{6}$/.test(cleaned);
        const res = await api.verifyEmail({
          code: isSixDigitCode ? cleaned : undefined,
          token: isSixDigitCode ? undefined : cleaned,
          email: email.trim() || undefined,
        });

        if (res.verified) {
          setVerified(true);
          setStatusMessage(res.message || 'Your email address has been verified.');
          trackEvent('auth_email_verified', { method });
          await refreshSession();
        } else {
          setErrorMessage(res.message || 'Verification could not be completed. Please try again.');
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'That verification code is invalid or expired. Request a new code below.';
        setErrorMessage(message);
      } finally {
        setSubmitting(false);
      }
    },
    [email, refreshSession]
  );

  // Auto-verify if a token was provided in the email link
  useEffect(() => {
    if (initialToken) {
      void submitVerification(initialToken, 'link');
    }
    // Run only once on mount for query-string token
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitVerification(codeOrToken, 'code');
  };

  const handleResend = async () => {
    setResending(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await api.resendVerification(email.trim() || undefined);
      setStatusMessage(
        res.message || 'If your account is unverified, a fresh verification code has been sent.'
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not resend right now. Please wait a moment and try again.';
      setErrorMessage(message);
    } finally {
      setResending(false);
    }
  };

  const loginAfterVerifyHref =
    safeReturnTo === '/'
      ? '/login?verified=1'
      : `/login?verified=1&returnTo=${encodeURIComponent(safeReturnTo)}`;

  return (
    <section className="muxaro-hero-surface w-full py-12 sm:py-16">
      <div className="max-w-md mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl bg-interactive text-brand-violet dark:text-content mx-auto flex items-center justify-center mb-4"
            aria-hidden="true"
          >
            <MailCheck className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-extrabold text-content tracking-tight mb-2">
            Verify your email
          </h1>
          <p className="text-sm sm:text-base text-content-secondary">
            Enter the verification code sent to your inbox to activate full access.
          </p>
        </div>

        <div className="rounded-2xl shadow-lg bg-surface border border-line p-6 sm:p-8 space-y-5">
          {verified ? (
            <div className="space-y-5 text-center">
              <div
                role="status"
                className="p-4 rounded-xl bg-success-bg border border-success text-success text-sm flex items-start gap-2.5 text-left"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{statusMessage || 'Your email address is verified.'}</span>
              </div>

              <Link
                href={authenticated ? safeReturnTo : loginAfterVerifyHref}
                className="muxaro-btn-primary w-full py-3 px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center active:translate-y-px whitespace-nowrap"
              >
                {authenticated ? 'Continue to workspace' : 'Sign in to your account'}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="verify-email-input" className="block text-sm font-medium text-content mb-1.5">
                  Email address
                </label>
                <div className="relative">
                  <Mail
                    className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="verify-email-input"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="verify-code-input" className="block text-sm font-medium text-content mb-1.5">
                  Verification code or token
                </label>
                <div className="relative">
                  <KeyRound
                    className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="verify-code-input"
                    type="text"
                    required
                    autoComplete="one-time-code"
                    value={codeOrToken}
                    onChange={(e) => setCodeOrToken(e.target.value)}
                    placeholder="Enter 6-digit code or link token"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                  />
                </div>
              </div>

              {statusMessage && (
                <div
                  role="status"
                  className="p-3.5 rounded-xl bg-info-bg border border-line text-content text-sm flex items-start gap-2.5"
                >
                  <CheckCircle2 className="w-4 h-4 text-brand-blue shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{statusMessage}</span>
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
                  {submitting ? 'Verifying…' : 'Verify email'}
                </span>
              </button>

              <div className="pt-3 border-t border-line flex items-center justify-between gap-2 text-xs text-content-secondary">
                <span>Did not receive a code?</span>
                <button
                  type="button"
                  disabled={resending}
                  aria-disabled={resending}
                  onClick={handleResend}
                  className="inline-flex items-center gap-1.5 font-semibold text-brand-violet dark:text-content hover:underline active:translate-y-px disabled:opacity-60 whitespace-nowrap"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 shrink-0${resending ? ' motion-safe:animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{resending ? 'Sending…' : 'Resend code'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto px-4 py-16 text-center text-sm text-content-secondary">
          Loading email verification…
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
