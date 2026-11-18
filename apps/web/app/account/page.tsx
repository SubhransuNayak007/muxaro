'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  Mail,
  Plus,
  Shield,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import {
  AuthUser,
  EntitlementsUsage,
  MfaSetupResponse,
  ProcessingJob,
  UserSessionInfo,
} from '@/lib/types';
import { formatUtcTimestamp } from '@/lib/formatters';

const ACTIVE_JOB_STATES = new Set([
  'CREATED',
  'VALIDATING',
  'QUEUED',
  'PROCESSING',
  'VERIFYING',
]);

function formatMemberDate(iso?: string): string {
  if (!iso) return 'Unavailable';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Unavailable';
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(displayName?: string | null, email?: string): string {
  const source = (displayName || email || 'M').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function formatPlanLabel(tier?: string): string {
  if (!tier) return 'Free';
  const normalized = tier.toLowerCase();
  if (normalized === 'premium') return 'Premium';
  return 'Free';
}

export default function AccountPage() {
  const {
    user,
    authenticated,
    loading: authLoading,
    refreshSession,
    logoutAll,
  } = useAuth();

  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [usage, setUsage] = useState<EntitlementsUsage | null>(null);
  const [sessions, setSessions] = useState<UserSessionInfo[]>([]);
  const [downloadCounts, setDownloadCounts] = useState<{
    active: number;
    completed: number;
  } | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Profile editor state
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameNotice, setNameNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  // Support ID copy state
  const [copiedPublicId, setCopiedPublicId] = useState(false);

  // Email verification resend state
  const [resendingVerification, setResendingVerification] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  // Session revocation state
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  // MFA state
  const [mfaSetup, setMfaSetup] = useState<MfaSetupResponse | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [disableMfaCode, setDisableMfaCode] = useState('');
  const [showDisableMfa, setShowDisableMfa] = useState(false);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [mfaNotice, setMfaNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  // Delete account flow state
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadAccountData = useCallback(async () => {
    setDataLoading(true);
    setLoadError(null);

    try {
      const [meRes, usageRes, sessionsRes, historyRes] = await Promise.allSettled([
        api.getMe(),
        api.getEntitlementsUsage(),
        api.getMySessions(),
        api.getHistory(),
      ]);

      if (meRes.status === 'fulfilled' && meRes.value) {
        setProfile(meRes.value);
        setDisplayNameInput(meRes.value.displayName || '');
      }
      if (usageRes.status === 'fulfilled' && usageRes.value) {
        setUsage(usageRes.value);
      }
      if (sessionsRes.status === 'fulfilled' && Array.isArray(sessionsRes.value)) {
        setSessions(sessionsRes.value);
      }
      if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value)) {
        const jobs = historyRes.value as ProcessingJob[];
        const active = jobs.filter((j) => ACTIVE_JOB_STATES.has(j.status)).length;
        const completed = jobs.filter((j) => j.status === 'READY').length;
        setDownloadCounts({ active, completed });
      }

      if (
        meRes.status === 'rejected' &&
        usageRes.status === 'rejected' &&
        sessionsRes.status === 'rejected'
      ) {
        setLoadError('Could not load account details right now. Please try again.');
      }
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated && user) {
      setDisplayNameInput((prev) => prev || user.displayName || '');
      loadAccountData();
    }
  }, [authenticated, user, loadAccountData]);

  const activeUser = profile || user;

  const handleCopyPublicId = async () => {
    if (!activeUser?.publicUserId) return;
    try {
      await navigator.clipboard.writeText(activeUser.publicUserId);
      setCopiedPublicId(true);
      setTimeout(() => setCopiedPublicId(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleSaveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = displayNameInput.trim();
    if (!trimmed) {
      setNameNotice({ kind: 'error', text: 'Display name cannot be empty.' });
      return;
    }

    setSavingName(true);
    setNameNotice(null);
    try {
      const updated = await api.updateMe({ displayName: trimmed });
      setProfile(updated);
      await refreshSession();
      setNameNotice({ kind: 'success', text: 'Display name updated.' });
    } catch (err: unknown) {
      setNameNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not update display name.',
      });
    } finally {
      setSavingName(false);
    }
  };

  const handleResendVerification = async () => {
    if (!activeUser?.email) return;
    setResendingVerification(true);
    setVerifyNotice(null);
    try {
      const res = await api.resendVerification(activeUser.email);
      setVerifyNotice(res.message || 'Verification instructions have been sent.');
    } catch (err: unknown) {
      setVerifyNotice(
        err instanceof Error ? err.message : 'Could not resend verification right now.'
      );
    } finally {
      setResendingVerification(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId);
    setSessionNotice(null);
    try {
      await api.revokeSession(sessionId);
      setSessions((prev) =>
        (Array.isArray(prev) ? prev : []).filter((s) => (s.sessionId || s.id) !== sessionId)
      );
      setSessionNotice('Session revoked.');
    } catch (err: unknown) {
      setSessionNotice(
        err instanceof Error ? err.message : 'Could not revoke this session.'
      );
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleLogoutAll = async () => {
    setSigningOutAll(true);
    try {
      await logoutAll();
    } finally {
      setSigningOutAll(false);
    }
  };

  const handleStartMfaSetup = async () => {
    setMfaBusy(true);
    setMfaNotice(null);
    try {
      const setup = await api.setupMfa();
      setMfaSetup(setup);
      setMfaCode('');
    } catch (err: unknown) {
      setMfaNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not start two-factor setup.',
      });
    } finally {
      setMfaBusy(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = mfaCode.replace(/\s+/g, '');
    if (cleaned.length < 6) {
      setMfaNotice({ kind: 'error', text: 'Enter the 6-digit code from your authenticator app.' });
      return;
    }

    setMfaBusy(true);
    setMfaNotice(null);
    try {
      const res = await api.verifyMfa(cleaned);
      setMfaSetup(null);
      setMfaCode('');
      await refreshSession();
      await loadAccountData();
      setMfaNotice({
        kind: 'success',
        text: res.message || 'Two-factor authentication verified.',
      });
    } catch (err: unknown) {
      setMfaNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Invalid verification code.',
      });
    } finally {
      setMfaBusy(false);
    }
  };

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = disableMfaCode.replace(/\s+/g, '');
    if (cleaned.length < 6) {
      setMfaNotice({ kind: 'error', text: 'Enter a valid 6-digit code to disable MFA.' });
      return;
    }

    setMfaBusy(true);
    setMfaNotice(null);
    try {
      const res = await api.disableMfa(cleaned);
      setDisableMfaCode('');
      setShowDisableMfa(false);
      await refreshSession();
      await loadAccountData();
      setMfaNotice({
        kind: 'success',
        text: res.message || 'Two-factor authentication disabled.',
      });
    } catch (err: unknown) {
      setMfaNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not disable two-factor authentication.',
      });
    } finally {
      setMfaBusy(false);
    }
  };

  const handleCopySecret = async () => {
    if (!mfaSetup?.secret) return;
    try {
      await navigator.clipboard.writeText(mfaSetup.secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setDeleteError('Type DELETE to confirm account deletion.');
      return;
    }

    setDeletingAccount(true);
    setDeleteError(null);
    try {
      await api.deleteMe({
        confirmation: 'DELETE',
        ...(deletePassword ? { password: deletePassword } : {}),
      });
      await refreshSession();
    } catch (err: unknown) {
      setDeleteError(
        err instanceof Error ? err.message : 'Could not delete account right now.'
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  // Lifted labels to satisfy concise button accessibility
  const copyIdLabel = copiedPublicId ? 'Copied' : 'Copy ID';
  const saveNameLabel = savingName ? 'Saving' : 'Save';
  const resendLabel = resendingVerification ? 'Sending' : 'Resend code';
  const signOutAllLabel = signingOutAll ? 'Signing out' : 'Sign out all';
  const copySecretLabel = copiedSecret ? 'Copied' : 'Copy key';
  const deleteSubmitLabel = deletingAccount ? 'Deleting' : 'Delete account';

  if (authLoading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--muxaro-bg-base)' }}>
        <div className="max-w-sheet mx-auto px-4 md:px-8 py-10 space-y-6" aria-busy="true">
          <div className="muxaro-card p-6 h-28 motion-safe:animate-pulse" aria-hidden="true" />
          <div className="muxaro-card p-6 h-56 motion-safe:animate-pulse" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (!authenticated || !activeUser) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--muxaro-bg-base)' }}>
        <div className="max-w-lg mx-auto px-4 py-16">
          <div className="muxaro-card p-8 text-center">
            <div
              className="mx-auto mb-4 flex items-center justify-center w-12 h-12"
              style={{
                background: 'var(--muxaro-gradient-subtle)',
                borderRadius: 'var(--muxaro-radius-md)',
                color: 'var(--muxaro-indigo)',
              }}
              aria-hidden="true"
            >
              <User className="w-6 h-6" />
            </div>
            <h1
              className="text-2xl font-bold mb-2"
              style={{ color: 'var(--muxaro-text-primary)' }}
            >
              Sign in to view your account
            </h1>
            <p
              className="text-sm mb-6"
              style={{ color: 'var(--muxaro-text-secondary)' }}
            >
              Manage your profile, support ID, active devices, and security settings.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login?returnTo=/account"
                className="muxaro-btn-primary inline-flex items-center justify-center text-sm font-semibold px-5 py-2.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                style={{ textDecoration: 'none', borderRadius: 'var(--muxaro-radius-sm)' }}
              >
                Sign in
              </Link>
              <Link
                href="/register?returnTo=/account"
                className="inline-flex items-center justify-center text-sm font-medium px-5 py-2.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                style={{
                  border: '1px solid var(--muxaro-border)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                  color: 'var(--muxaro-text-primary)',
                  backgroundColor: 'var(--muxaro-bg-surface)',
                  textDecoration: 'none',
                }}
              >
                Create free account
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const planLabel = formatPlanLabel(usage?.tier || activeUser.tier);
  const memberSinceText = formatMemberDate(
    (profile as AuthUser | null)?.memberSince ||
      (profile as AuthUser | null)?.createdAt
  );

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--muxaro-bg-base)' }}>
      <div className="max-w-sheet mx-auto px-4 md:px-8 py-8 md:py-12 space-y-8">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1
              className="text-2xl sm:text-3xl font-bold"
              style={{
                color: 'var(--muxaro-text-primary)',
                letterSpacing: '-0.02em',
                lineHeight: '1.2',
              }}
            >
              Good to see you again.
            </h1>
            <p
              className="text-sm mt-1.5"
              style={{ color: 'var(--muxaro-text-secondary)' }}
            >
              Manage your identity, live usage, active devices, and account security.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {activeUser.role === 'admin' && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                style={{
                  border: '1px solid var(--muxaro-border)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                  color: 'var(--muxaro-text-primary)',
                  backgroundColor: 'var(--muxaro-bg-surface)',
                  textDecoration: 'none',
                }}
              >
                <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Admin centre</span>
              </Link>
            )}
            <Link
              href="/"
              className="muxaro-btn-primary inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
              style={{ textDecoration: 'none', borderRadius: 'var(--muxaro-radius-sm)' }}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Start new task</span>
            </Link>
          </div>
        </header>

        {loadError && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            style={{
              backgroundColor: 'var(--muxaro-error-bg)',
              border: '1px solid var(--muxaro-error)',
              borderRadius: 'var(--muxaro-radius-md)',
              color: 'var(--muxaro-text-primary)',
            }}
            role="alert"
          >
            <span>{loadError}</span>
            <button
              type="button"
              onClick={loadAccountData}
              className="text-xs font-semibold px-3 py-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--muxaro-bg-surface)',
                border: '1px solid var(--muxaro-border)',
                borderRadius: 'var(--muxaro-radius-sm)',
                color: 'var(--muxaro-text-primary)',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Profile & Support Identity */}
        <section className="muxaro-card p-6" aria-label="Account profile">
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            {/* Avatar */}
            <div className="shrink-0">
              {activeUser.avatarUrl ? (
                <img
                  src={activeUser.avatarUrl}
                  alt={activeUser.displayName || 'Account avatar'}
                  width={64}
                  height={64}
                  className="w-16 h-16 object-cover"
                  style={{ borderRadius: 'var(--muxaro-radius-full)' }}
                />
              ) : (
                <div
                  className="w-16 h-16 flex items-center justify-center text-lg font-bold"
                  style={{
                    background: 'var(--muxaro-gradient-primary)',
                    color: 'var(--muxaro-btn-fg)',
                    borderRadius: 'var(--muxaro-radius-full)',
                  }}
                  aria-hidden="true"
                >
                  {getInitials(activeUser.displayName, activeUser.email)}
                </div>
              )}
            </div>

            {/* Identity Details & Display Name Editor */}
            <div className="flex-1 min-w-0 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2
                      className="text-lg font-semibold truncate"
                      style={{ color: 'var(--muxaro-text-primary)' }}
                    >
                      {activeUser.displayName || activeUser.email}
                    </h2>
                    <span
                      className="text-xs font-medium px-2.5 py-0.5"
                      style={{
                        backgroundColor: 'var(--muxaro-info-bg)',
                        color: 'var(--muxaro-info)',
                        borderRadius: 'var(--muxaro-radius-full)',
                      }}
                    >
                      {planLabel} plan
                    </span>
                  </div>
                  <p
                    className="text-sm mt-0.5 truncate"
                    style={{ color: 'var(--muxaro-text-secondary)' }}
                  >
                    {activeUser.email}
                  </p>
                </div>

                {/* Email verification badge */}
                <div className="flex flex-wrap items-center gap-2">
                  {activeUser.emailVerified ? (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1"
                      style={{
                        backgroundColor: 'var(--muxaro-success-bg)',
                        color: 'var(--muxaro-success)',
                        borderRadius: 'var(--muxaro-radius-full)',
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Email verified</span>
                    </span>
                  ) : (
                    <>
                      <span
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1"
                        style={{
                          backgroundColor: 'var(--muxaro-warning-bg)',
                          color: 'var(--muxaro-warning)',
                          borderRadius: 'var(--muxaro-radius-full)',
                        }}
                      >
                        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Unverified email</span>
                      </span>
                      <Link
                        href="/verify-email"
                        className="text-xs font-semibold px-2.5 py-1 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                        style={{
                          color: 'var(--muxaro-indigo)',
                          textDecoration: 'none',
                          borderRadius: 'var(--muxaro-radius-sm)',
                        }}
                      >
                        Verify email
                      </Link>
                      <button
                        type="button"
                        onClick={handleResendVerification}
                        disabled={resendingVerification}
                        className="text-xs font-medium px-2.5 py-1 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          border: '1px solid var(--muxaro-border)',
                          borderRadius: 'var(--muxaro-radius-sm)',
                          color: 'var(--muxaro-text-secondary)',
                          backgroundColor: 'var(--muxaro-bg-surface)',
                        }}
                      >
                        {resendLabel}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {verifyNotice && (
                <p
                  className="text-xs px-3 py-2"
                  style={{
                    backgroundColor: 'var(--muxaro-info-bg)',
                    color: 'var(--muxaro-info)',
                    borderRadius: 'var(--muxaro-radius-sm)',
                  }}
                >
                  {verifyNotice}
                </p>
              )}

              {/* Support Public User ID & Member Since */}
              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4"
                style={{ borderTop: '1px solid var(--muxaro-border-subtle)' }}
              >
                <div>
                  <span
                    className="block text-xs mb-1"
                    style={{ color: 'var(--muxaro-text-tertiary)' }}
                  >
                    Public User ID
                  </span>
                  <div className="flex items-center gap-2">
                    <code
                      className="text-sm font-semibold mono-metric px-2.5 py-1"
                      style={{
                        backgroundColor: 'var(--muxaro-bg-elevated)',
                        color: 'var(--muxaro-text-primary)',
                        borderRadius: 'var(--muxaro-radius-sm)',
                      }}
                    >
                      {activeUser.publicUserId}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyPublicId}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                      style={{
                        border: '1px solid var(--muxaro-border)',
                        borderRadius: 'var(--muxaro-radius-sm)',
                        color: copiedPublicId
                          ? 'var(--muxaro-success)'
                          : 'var(--muxaro-text-secondary)',
                        backgroundColor: 'var(--muxaro-bg-surface)',
                      }}
                      aria-label="Copy ID for support"
                    >
                      {copiedPublicId ? (
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>{copyIdLabel}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <span
                    className="block text-xs mb-1"
                    style={{ color: 'var(--muxaro-text-tertiary)' }}
                  >
                    Member since
                  </span>
                  <p
                    className="text-sm font-medium py-1"
                    style={{ color: 'var(--muxaro-text-primary)' }}
                  >
                    {memberSinceText}
                  </p>
                </div>
              </div>

              {/* Display Name Form */}
              <form
                onSubmit={handleSaveDisplayName}
                className="pt-4 space-y-2"
                style={{ borderTop: '1px solid var(--muxaro-border-subtle)' }}
              >
                <label
                  htmlFor="account-display-name"
                  className="block text-xs font-medium"
                  style={{ color: 'var(--muxaro-text-secondary)' }}
                >
                  Display name
                </label>
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    id="account-display-name"
                    type="text"
                    value={displayNameInput}
                    onChange={(e) => setDisplayNameInput(e.target.value)}
                    maxLength={80}
                    placeholder="Your display name"
                    className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    style={{
                      backgroundColor: 'var(--muxaro-bg-base)',
                      border: '1px solid var(--muxaro-border)',
                      borderRadius: 'var(--muxaro-radius-sm)',
                      color: 'var(--muxaro-text-primary)',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={savingName}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: 'var(--muxaro-bg-elevated)',
                      border: '1px solid var(--muxaro-border)',
                      borderRadius: 'var(--muxaro-radius-sm)',
                      color: 'var(--muxaro-text-primary)',
                    }}
                  >
                    {savingName && (
                      <Loader2
                        className="w-3.5 h-3.5 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    <span>{saveNameLabel}</span>
                  </button>
                </div>
                {nameNotice && (
                  <p
                    className="text-xs"
                    style={{
                      color:
                        nameNotice.kind === 'success'
                          ? 'var(--muxaro-success)'
                          : 'var(--muxaro-error)',
                    }}
                  >
                    {nameNotice.text}
                  </p>
                )}
              </form>
            </div>
          </div>
        </section>

        {/* Live Usage Summary Strip (unified divider layout, no nested cards) */}
        <section className="muxaro-card p-6" aria-label="Live usage summary">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2
              className="text-base font-semibold"
              style={{ color: 'var(--muxaro-text-primary)' }}
            >
              Live usage summary
            </h2>
            <div className="flex items-center gap-4 text-xs font-medium">
              <Link
                href="/credits"
                className="whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                style={{ color: 'var(--muxaro-indigo)', textDecoration: 'none' }}
              >
                View usage
              </Link>
              <Link
                href="/dashboard"
                className="whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                style={{ color: 'var(--muxaro-indigo)', textDecoration: 'none' }}
              >
                My Downloads
              </Link>
            </div>
          </div>

          <div
            className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2"
            style={{ borderTop: '1px solid var(--muxaro-border-subtle)' }}
          >
            <div>
              <span
                className="block text-xs mb-1"
                style={{ color: 'var(--muxaro-text-secondary)' }}
              >
                Remaining video jobs
              </span>
              <p
                className="text-xl font-bold mono-metric"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                {usage
                  ? `${usage.baseRemaining} / ${usage.baseLimit}`
                  : dataLoading
                  ? 'Loading'
                  : 'Unavailable'}
              </p>
            </div>

            <div>
              <span
                className="block text-xs mb-1"
                style={{ color: 'var(--muxaro-text-secondary)' }}
              >
                Extra credits earned
              </span>
              <p
                className="text-xl font-bold mono-metric"
                style={{ color: 'var(--muxaro-success)' }}
              >
                {usage
                  ? `+${usage.extraCreditsRemaining}`
                  : dataLoading
                  ? 'Loading'
                  : 'Unavailable'}
              </p>
            </div>

            <div>
              <span
                className="block text-xs mb-1"
                style={{ color: 'var(--muxaro-text-secondary)' }}
              >
                Downloads activity
              </span>
              <p
                className="text-xl font-bold mono-metric"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                {downloadCounts
                  ? `${downloadCounts.active} active, ${downloadCounts.completed} ready`
                  : dataLoading
                  ? 'Loading'
                  : 'Unavailable'}
              </p>
            </div>
          </div>
        </section>

        {/* Active Sessions & Devices */}
        <section className="muxaro-card p-6" aria-label="Active sessions and devices">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                Active sessions and devices
              </h2>
              <p
                className="text-xs mt-0.5"
                style={{ color: 'var(--muxaro-text-secondary)' }}
              >
                Review signed-in browsers and revoke any device you no longer recognize.
              </p>
            </div>

            <button
              type="button"
              onClick={handleLogoutAll}
              disabled={signingOutAll}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                border: '1px solid var(--muxaro-border)',
                borderRadius: 'var(--muxaro-radius-sm)',
                color: 'var(--muxaro-error)',
                backgroundColor: 'var(--muxaro-bg-surface)',
              }}
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{signOutAllLabel}</span>
            </button>
          </div>

          {sessionNotice && (
            <p
              className="text-xs mb-3 px-3 py-2"
              style={{
                backgroundColor: 'var(--muxaro-bg-elevated)',
                color: 'var(--muxaro-text-secondary)',
                borderRadius: 'var(--muxaro-radius-sm)',
              }}
            >
              {sessionNotice}
            </p>
          )}

          {dataLoading && safeSessions.length === 0 ? (
            <div className="h-20 motion-safe:animate-pulse" aria-hidden="true" />
          ) : safeSessions.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muxaro-text-secondary)' }}>
              No active session records found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr
                    className="text-xs"
                    style={{
                      color: 'var(--muxaro-text-tertiary)',
                      borderBottom: '1px solid var(--muxaro-border)',
                    }}
                  >
                    <th className="py-2.5 pr-4 font-medium">Device</th>
                    <th className="py-2.5 px-4 font-medium">Network</th>
                    <th className="py-2.5 px-4 font-medium">Last active</th>
                    <th className="py-2.5 pl-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {safeSessions.map((session) => {
                    const sid = session.sessionId || session.id;
                    const isRevoking = revokingSessionId === sid;
                    return (
                      <tr
                        key={sid}
                        style={{ borderBottom: '1px solid var(--muxaro-border-subtle)' }}
                      >
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2 min-w-0">
                            <Laptop
                              className="w-4 h-4 shrink-0"
                              style={{ color: 'var(--muxaro-text-tertiary)' }}
                              aria-hidden="true"
                            />
                            <span
                              className="truncate max-w-xs"
                              style={{ color: 'var(--muxaro-text-primary)' }}
                              title={session.userAgent}
                            >
                              {session.userAgent}
                            </span>
                            {session.current && (
                              <span
                                className="text-xs font-medium px-2 py-0.5 shrink-0"
                                style={{
                                  backgroundColor: 'var(--muxaro-success-bg)',
                                  color: 'var(--muxaro-success)',
                                  borderRadius: 'var(--muxaro-radius-full)',
                                }}
                              >
                                Current
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          className="py-3 px-4 text-xs mono-metric"
                          style={{ color: 'var(--muxaro-text-secondary)' }}
                        >
                          {session.ipPrefix || 'Private'}
                        </td>
                        <td
                          className="py-3 px-4 text-xs"
                          style={{ color: 'var(--muxaro-text-secondary)' }}
                        >
                          {session.lastSeenAt
                            ? formatUtcTimestamp(session.lastSeenAt)
                            : 'Active'}
                        </td>
                        <td className="py-3 pl-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleRevokeSession(sid)}
                            disabled={isRevoking}
                            className="text-xs font-medium px-2.5 py-1 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              border: '1px solid var(--muxaro-border)',
                              borderRadius: 'var(--muxaro-radius-sm)',
                              color: 'var(--muxaro-error)',
                              backgroundColor: 'var(--muxaro-bg-surface)',
                            }}
                          >
                            {isRevoking ? 'Revoking' : 'Revoke'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Two-Factor Authentication (TOTP MFA) */}
        <section
          id="mfa"
          className="muxaro-card p-6 space-y-4"
          aria-label="Two-factor authentication"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: 'var(--muxaro-bg-elevated)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                  color: 'var(--muxaro-indigo)',
                }}
                aria-hidden="true"
              >
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h2
                  className="text-base font-semibold"
                  style={{ color: 'var(--muxaro-text-primary)' }}
                >
                  Two-factor authentication
                </h2>
                <p
                  className="text-xs mt-0.5"
                  style={{ color: 'var(--muxaro-text-secondary)' }}
                >
                  Protect your account with an authenticator app using time-based 6-digit codes.
                </p>
              </div>
            </div>

            {activeUser.mfaEnabled ? (
              <span
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1"
                style={{
                  backgroundColor: 'var(--muxaro-success-bg)',
                  color: 'var(--muxaro-success)',
                  borderRadius: 'var(--muxaro-radius-full)',
                }}
              >
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Enabled</span>
              </span>
            ) : (
              <span
                className="text-xs font-medium px-2.5 py-1"
                style={{
                  backgroundColor: 'var(--muxaro-bg-elevated)',
                  color: 'var(--muxaro-text-secondary)',
                  borderRadius: 'var(--muxaro-radius-full)',
                }}
              >
                Not enabled
              </span>
            )}
          </div>

          {mfaNotice && (
            <p
              className="text-xs px-3 py-2"
              style={{
                backgroundColor:
                  mfaNotice.kind === 'success'
                    ? 'var(--muxaro-success-bg)'
                    : 'var(--muxaro-error-bg)',
                color:
                  mfaNotice.kind === 'success'
                    ? 'var(--muxaro-success)'
                    : 'var(--muxaro-error)',
                borderRadius: 'var(--muxaro-radius-sm)',
              }}
              role="status"
            >
              {mfaNotice.text}
            </p>
          )}

          {!activeUser.mfaEnabled && !mfaSetup && (
            <div>
              <button
                type="button"
                onClick={handleStartMfaSetup}
                disabled={mfaBusy}
                className="muxaro-btn-primary inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderRadius: 'var(--muxaro-radius-sm)' }}
              >
                {mfaBusy && (
                  <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
                )}
                <span>Set up authenticator</span>
              </button>
            </div>
          )}

          {mfaSetup && (
            <div
              className="p-4 space-y-4"
              style={{
                backgroundColor: 'var(--muxaro-bg-elevated)',
                borderRadius: 'var(--muxaro-radius-md)',
              }}
            >
              <p className="text-xs" style={{ color: 'var(--muxaro-text-secondary)' }}>
                Add this setup key to your authenticator app, then enter the 6-digit code below to activate two-factor authentication.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code
                  className="text-xs font-semibold mono-metric px-3 py-1.5 break-all"
                  style={{
                    backgroundColor: 'var(--muxaro-bg-surface)',
                    border: '1px solid var(--muxaro-border)',
                    borderRadius: 'var(--muxaro-radius-sm)',
                    color: 'var(--muxaro-text-primary)',
                  }}
                >
                  {mfaSetup.secret}
                </code>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                  style={{
                    backgroundColor: 'var(--muxaro-bg-surface)',
                    border: '1px solid var(--muxaro-border)',
                    borderRadius: 'var(--muxaro-radius-sm)',
                    color: 'var(--muxaro-text-secondary)',
                  }}
                >
                  {copiedSecret ? (
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{copySecretLabel}</span>
                </button>
              </div>

              <form onSubmit={handleVerifyMfa} className="flex flex-wrap items-center gap-2.5">
                <label htmlFor="mfa-setup-code" className="sr-only">
                  6-digit authenticator code
                </label>
                <input
                  id="mfa-setup-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="6-digit code"
                  className="w-40 px-3 py-2 text-sm mono-metric focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  style={{
                    backgroundColor: 'var(--muxaro-bg-surface)',
                    border: '1px solid var(--muxaro-border)',
                    borderRadius: 'var(--muxaro-radius-sm)',
                    color: 'var(--muxaro-text-primary)',
                  }}
                />
                <button
                  type="submit"
                  disabled={mfaBusy}
                  className="muxaro-btn-primary text-xs font-semibold px-4 py-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderRadius: 'var(--muxaro-radius-sm)' }}
                >
                  Verify and enable
                </button>
                <button
                  type="button"
                  onClick={() => setMfaSetup(null)}
                  className="text-xs font-medium px-3 py-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                  style={{ color: 'var(--muxaro-text-secondary)' }}
                >
                  Cancel
                </button>
              </form>
            </div>
          )}

          {activeUser.mfaEnabled && (
            <div className="space-y-3">
              {!activeUser.mfaVerified && (
                <form
                  onSubmit={handleVerifyMfa}
                  className="flex flex-wrap items-center gap-2.5 p-3"
                  style={{
                    backgroundColor: 'var(--muxaro-warning-bg)',
                    borderRadius: 'var(--muxaro-radius-sm)',
                  }}
                >
                  <span
                    className="text-xs font-medium"
                    style={{ color: 'var(--muxaro-text-primary)' }}
                  >
                    Verify this session with your authenticator code:
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="6-digit code"
                    aria-label="Authenticator code"
                    className="w-36 px-2.5 py-1.5 text-xs mono-metric focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    style={{
                      backgroundColor: 'var(--muxaro-bg-surface)',
                      border: '1px solid var(--muxaro-border)',
                      borderRadius: 'var(--muxaro-radius-sm)',
                      color: 'var(--muxaro-text-primary)',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={mfaBusy}
                    className="muxaro-btn-primary text-xs font-semibold px-3 py-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderRadius: 'var(--muxaro-radius-sm)' }}
                  >
                    Verify session
                  </button>
                </form>
              )}

              {!showDisableMfa ? (
                <button
                  type="button"
                  onClick={() => setShowDisableMfa(true)}
                  className="text-xs font-medium px-3 py-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                  style={{
                    border: '1px solid var(--muxaro-border)',
                    borderRadius: 'var(--muxaro-radius-sm)',
                    color: 'var(--muxaro-text-secondary)',
                    backgroundColor: 'var(--muxaro-bg-surface)',
                  }}
                >
                  Disable two-factor
                </button>
              ) : (
                <form
                  onSubmit={handleDisableMfa}
                  className="flex flex-wrap items-center gap-2.5"
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    value={disableMfaCode}
                    onChange={(e) => setDisableMfaCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    aria-label="Code to disable two-factor authentication"
                    className="w-40 px-3 py-1.5 text-xs mono-metric focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    style={{
                      backgroundColor: 'var(--muxaro-bg-base)',
                      border: '1px solid var(--muxaro-border)',
                      borderRadius: 'var(--muxaro-radius-sm)',
                      color: 'var(--muxaro-text-primary)',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={mfaBusy}
                    className="text-xs font-semibold px-3 py-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: 'var(--muxaro-error-bg)',
                      color: 'var(--muxaro-error)',
                      borderRadius: 'var(--muxaro-radius-sm)',
                    }}
                  >
                    Confirm disable
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDisableMfa(false);
                      setDisableMfaCode('');
                    }}
                    className="text-xs font-medium px-2.5 py-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    style={{ color: 'var(--muxaro-text-secondary)' }}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
          )}
        </section>

        {/* Delete Account */}
        <section
          className="muxaro-card p-6 space-y-4"
          aria-label="Delete account"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--muxaro-error)' }}
              >
                Delete account
              </h2>
              <p
                className="text-xs mt-0.5"
                style={{ color: 'var(--muxaro-text-secondary)' }}
              >
                Permanently deactivate your account and revoke all active sessions.
              </p>
            </div>
            {!showDeleteForm && (
              <button
                type="button"
                onClick={() => setShowDeleteForm(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                style={{
                  border: '1px solid var(--muxaro-error)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                  color: 'var(--muxaro-error)',
                  backgroundColor: 'var(--muxaro-bg-surface)',
                }}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Delete account</span>
              </button>
            )}
          </div>

          {showDeleteForm && (
            <form
              onSubmit={handleDeleteAccount}
              className="p-4 space-y-3"
              style={{
                backgroundColor: 'var(--muxaro-error-bg)',
                borderRadius: 'var(--muxaro-radius-md)',
              }}
            >
              <p className="text-xs" style={{ color: 'var(--muxaro-text-primary)' }}>
                Type <strong>DELETE</strong> to confirm. All active sessions will be signed out immediately.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Type DELETE"
                  aria-label="Type DELETE to confirm"
                  className="px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  style={{
                    backgroundColor: 'var(--muxaro-bg-surface)',
                    border: '1px solid var(--muxaro-border)',
                    borderRadius: 'var(--muxaro-radius-sm)',
                    color: 'var(--muxaro-text-primary)',
                  }}
                />
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Password (if set)"
                  aria-label="Current password"
                  className="px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  style={{
                    backgroundColor: 'var(--muxaro-bg-surface)',
                    border: '1px solid var(--muxaro-border)',
                    borderRadius: 'var(--muxaro-radius-sm)',
                    color: 'var(--muxaro-text-primary)',
                  }}
                />
              </div>
              {deleteError && (
                <p className="text-xs" style={{ color: 'var(--muxaro-error)' }} role="alert">
                  {deleteError}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="submit"
                  disabled={deletingAccount}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'var(--muxaro-error)',
                    color: 'var(--muxaro-btn-fg)',
                    borderRadius: 'var(--muxaro-radius-sm)',
                  }}
                >
                  {deletingAccount && (
                    <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
                  )}
                  <span>{deleteSubmitLabel}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteForm(false);
                    setDeleteConfirmText('');
                    setDeletePassword('');
                    setDeleteError(null);
                  }}
                  className="text-xs font-medium px-3 py-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  style={{ color: 'var(--muxaro-text-secondary)' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Quick Support Footer Note */}
        <div
          className="flex items-center gap-2 text-xs"
          style={{ color: 'var(--muxaro-text-tertiary)' }}
        >
          <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>
            Share your Public User ID when contacting support. Never share your password or authenticator key.
          </span>
        </div>
      </div>
    </div>
  );
}
