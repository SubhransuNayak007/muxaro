'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Mail,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { api } from '@/lib/api-client';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const initialToken = (searchParams.get('token') || '').trim();

  const [mode, setMode] = useState<'request' | 'complete'>(
    initialToken ? 'complete' : 'request'
  );
  const [email, setEmail] = useState<string>('');
  const [token, setToken] = useState<string>(initialToken);
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [completed, setCompleted] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await api.forgotPassword(trimmedEmail);
      setStatusMessage(
        res.message ||
          'If an account matches that email, password recovery instructions have been sent.'
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not submit your request right now. Please try again.';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedToken = token.trim();
    if (!cleanedToken) {
      setErrorMessage('Please enter your password reset token.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMessage('Please choose a new password with at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('Your passwords do not match. Please re-enter them.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await api.resetPassword({
        token: cleanedToken,
        newPassword,
      });
      setCompleted(true);
      setStatusMessage(
        res.message ||
          'Your password has been updated and previous sessions have been signed out.'
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'That reset link is invalid or expired. Please request a new one.';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="muxaro-hero-surface w-full py-12 sm:py-16">
      <div className="max-w-md mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-content tracking-tight mb-2">
            {mode === 'complete' ? 'Set a new password' : 'Reset your password'}
          </h1>
          <p className="text-sm sm:text-base text-content-secondary">
            {mode === 'complete'
              ? 'Choose a strong password for your Muxaro account.'
              : 'Enter your email and we will send recovery instructions.'}
          </p>
        </div>

        <div className="rounded-2xl shadow-lg bg-surface border border-line p-6 sm:p-8 space-y-5">
          {completed ? (
            <div className="space-y-5 text-center">
              <div
                role="status"
                className="p-4 rounded-xl bg-success-bg border border-success text-success text-sm flex items-start gap-2.5 text-left"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{statusMessage}</span>
              </div>

              <Link
                href="/login?reset=1"
                className="muxaro-btn-primary w-full py-3 px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center active:translate-y-px whitespace-nowrap"
              >
                Sign in with new password
              </Link>
            </div>
          ) : mode === 'request' ? (
            <form onSubmit={handleRequestReset} className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="block text-sm font-medium text-content mb-1.5">
                  Email address
                </label>
                <div className="relative">
                  <Mail
                    className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reset-email"
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

              {statusMessage && (
                <div
                  role="status"
                  className="p-3.5 rounded-xl bg-success-bg border border-success text-success text-sm flex items-start gap-2.5"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
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
                  {submitting ? 'Sending instructions…' : 'Send reset instructions'}
                </span>
              </button>

              <div className="pt-3 border-t border-line flex items-center justify-between gap-2 text-xs text-content-secondary">
                <button
                  type="button"
                  onClick={() => {
                    setMode('complete');
                    setErrorMessage(null);
                    setStatusMessage(null);
                  }}
                  className="font-medium text-brand-violet dark:text-content hover:underline active:translate-y-px whitespace-nowrap"
                >
                  Have a reset token?
                </button>
                <Link
                  href="/login"
                  className="font-medium text-content-secondary hover:text-content whitespace-nowrap"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          ) : (
            <form onSubmit={handleCompleteReset} className="space-y-4">
              <div>
                <label htmlFor="reset-token" className="block text-sm font-medium text-content mb-1.5">
                  Reset token
                </label>
                <div className="relative">
                  <KeyRound
                    className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reset-token"
                    type="text"
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste your reset token"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="reset-new-password" className="block text-sm font-medium text-content mb-1.5">
                  New password
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reset-new-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="reset-confirm-password" className="block text-sm font-medium text-content mb-1.5">
                  Confirm new password
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-content-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reset-confirm-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your new password"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-base border border-line text-content placeholder:text-content-muted text-sm focus:border-brand-violet transition-colors duration-150"
                  />
                </div>
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
                  {submitting ? 'Updating password…' : 'Update password'}
                </span>
              </button>

              <div className="pt-3 border-t border-line flex items-center justify-between gap-2 text-xs text-content-secondary">
                <button
                  type="button"
                  onClick={() => {
                    setMode('request');
                    setErrorMessage(null);
                    setStatusMessage(null);
                  }}
                  className="font-medium text-brand-violet dark:text-content hover:underline active:translate-y-px whitespace-nowrap"
                >
                  Request a new reset link
                </button>
                <Link
                  href="/login"
                  className="font-medium text-content-secondary hover:text-content whitespace-nowrap"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-content-secondary inline-flex items-center justify-center gap-1.5 w-full">
          <ShieldCheck className="w-4 h-4 text-brand-violet shrink-0" aria-hidden="true" />
          <span>Resetting your password signs out all other active devices.</span>
        </p>
      </div>
    </section>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto px-4 py-16 text-center text-sm text-content-secondary">
          Loading password recovery…
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
