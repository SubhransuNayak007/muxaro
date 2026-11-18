'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import {
  AdminAnalyticsSummary,
  AdminAuditLog,
  AdminPlatformSettings,
  AdminRewardsSummary,
  AdminSearchResult,
  AdminSecurityEvent,
  AdminUserSummary,
  MfaSetupResponse,
  SystemHealthMetrics,
} from '@/lib/types';
import { formatUtcTimestamp } from '@/lib/formatters';

type AdminTab = 'users' | 'settings' | 'analytics' | 'system';

const QUEUE_CLASS_NAMES = [
  'instant-processing',
  'audio-processing',
  'merge-processing',
  'video-transcoding',
  'high-resolution-processing',
  'playlist-packaging',
] as const;

function formatMs(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function formatNumber(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return value.toLocaleString();
}

export default function AdminPage() {
  const { user, authenticated, loading: authLoading, refreshSession } = useAuth();

  // Admin MFA Gate state
  const [mfaSetup, setMfaSetup] = useState<MfaSetupResponse | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [refreshing, setRefreshing] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);

  // Tab 1: Support Search & Users
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<AdminSearchResult | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [userActionBusy, setUserActionBusy] = useState<string | null>(null);
  const [userActionNotice, setUserActionNotice] = useState<string | null>(null);

  // Tab 2: Quota & Platform Settings
  const [settings, setSettings] = useState<AdminPlatformSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  // Tab 3: Rewards & Analytics
  const [rewards, setRewards] = useState<AdminRewardsSummary | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalyticsSummary | null>(null);

  // Tab 4: System Health & Audit Logs
  const [metrics, setMetrics] = useState<SystemHealthMetrics | null>(null);
  const [securityEvents, setSecurityEvents] = useState<AdminSecurityEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);

  const isAdmin = Boolean(authenticated && user && user.role === 'admin');
  const isMfaCleared = Boolean(isAdmin && user?.mfaVerified);

  const loadTabData = useCallback(
    async (tab: AdminTab) => {
      if (!isMfaCleared) return;
      setRefreshing(true);
      setTabError(null);
      try {
        if (tab === 'users') {
          const list = await api.adminListUsers({ limit: 50 });
          setUsers(Array.isArray(list) ? list : []);
        } else if (tab === 'settings') {
          const cfg = await api.adminGetSettings();
          setSettings(cfg);
        } else if (tab === 'analytics') {
          const [rwd, anl] = await Promise.all([
            api.adminGetRewards(),
            api.adminGetAnalytics(),
          ]);
          setRewards(rwd);
          setAnalytics(anl);
        } else if (tab === 'system') {
          const [m, sec, aud] = await Promise.all([
            api.getSystemMetrics(),
            api.adminGetSecurityEvents(50),
            api.adminGetAuditLogs(50),
          ]);
          setMetrics(m);
          setSecurityEvents(Array.isArray(sec) ? sec : []);
          setAuditLogs(Array.isArray(aud) ? aud : []);
        }
      } catch (err: unknown) {
        setTabError(
          err instanceof Error
            ? err.message
            : 'Could not load administrator data right now.'
        );
      } finally {
        setRefreshing(false);
      }
    },
    [isMfaCleared]
  );

  useEffect(() => {
    if (isMfaCleared) {
      loadTabData(activeTab);
    }
  }, [isMfaCleared, activeTab, loadTabData]);

  // MFA Gate Handlers
  const handleStartAdminMfa = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const setup = await api.setupMfa();
      setMfaSetup(setup);
    } catch (err: unknown) {
      setMfaError(err instanceof Error ? err.message : 'Could not start MFA setup.');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleVerifyAdminMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = mfaCode.replace(/\s+/g, '');
    if (cleaned.length < 6) {
      setMfaError('Enter your 6-digit authenticator code.');
      return;
    }

    setMfaBusy(true);
    setMfaError(null);
    try {
      await api.verifyMfa(cleaned);
      setMfaCode('');
      setMfaSetup(null);
      await refreshSession();
    } catch (err: unknown) {
      setMfaError(err instanceof Error ? err.message : 'Verification failed.');
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

  // Tab 1 Handlers
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResult(null);
      return;
    }
    setSearching(true);
    setTabError(null);
    try {
      const res = await api.adminSearch(q);
      setSearchResult(res);
    } catch (err: unknown) {
      setTabError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleUserAction = async (
    targetUser: AdminUserSummary,
    action: 'suspend' | 'restore' | 'revoke'
  ) => {
    const busyKey = `${action}:${targetUser.id}`;
    setUserActionBusy(busyKey);
    setUserActionNotice(null);
    try {
      if (action === 'suspend') {
        await api.adminSuspendUser(targetUser.id, 'Suspended via Admin Control Centre');
        setUserActionNotice(`Suspended ${targetUser.publicUserId}.`);
      } else if (action === 'restore') {
        await api.adminRestoreUser(targetUser.id);
        setUserActionNotice(`Restored ${targetUser.publicUserId}.`);
      } else {
        const res = await api.adminRevokeUserSessions(targetUser.id);
        const count = typeof res.revokedCount === 'number' ? res.revokedCount : 0;
        setUserActionNotice(`Revoked ${count} session(s) for ${targetUser.publicUserId}.`);
      }
      await loadTabData('users');
      if (searchQuery.trim()) {
        const refreshedSearch = await api.adminSearch(searchQuery.trim());
        setSearchResult(refreshedSearch);
      }
    } catch (err: unknown) {
      setUserActionNotice(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setUserActionBusy(null);
    }
  };

  // Tab 2 Handler
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    setSettingsNotice(null);
    try {
      const updated = await api.adminUpdateSettings({
        baseVideoAllowance: Number(settings.baseVideoAllowance),
        playlistAllowance: Number(settings.playlistAllowance),
        rewardCreditsPerAd: Number(settings.rewardCreditsPerAd),
        rewardDailyCap: Number(settings.rewardDailyCap),
        rewardExpiryHours: Number(settings.rewardExpiryHours),
        guestConcurrency: Number(settings.guestConcurrency),
        freeConcurrency: Number(settings.freeConcurrency),
        premiumConcurrency: Number(settings.premiumConcurrency),
        maxUploadSizeMb: Number(settings.maxUploadSizeMb),
        maxPlaylistItems: Number(settings.maxPlaylistItems),
        rewardedAdsEnabled: Boolean(settings.rewardedAdsEnabled),
      });
      setSettings(updated);
      setSettingsNotice({ kind: 'success', text: 'Platform settings saved and audited.' });
    } catch (err: unknown) {
      setSettingsNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not update platform settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const updateSettingNumber = (key: keyof AdminPlatformSettings, raw: string) => {
    const parsed = Number(raw);
    setSettings((prev) =>
      prev ? { ...prev, [key]: Number.isFinite(parsed) ? parsed : 0 } : prev
    );
  };

  // Lifted labels
  const copySecretLabel = copiedSecret ? 'Copied' : 'Copy key';
  const refreshLabel = refreshing ? 'Refreshing' : 'Refresh';
  const searchBtnLabel = searching ? 'Searching' : 'Search';
  const saveSettingsLabel = savingSettings ? 'Saving' : 'Save settings';

  if (authLoading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--muxaro-bg-base)' }}>
        <div className="max-w-sheet mx-auto px-4 md:px-8 py-12 space-y-4" aria-busy="true">
          <div className="muxaro-card p-6 h-24 motion-safe:animate-pulse" aria-hidden="true" />
          <div className="muxaro-card p-6 h-64 motion-safe:animate-pulse" aria-hidden="true" />
        </div>
      </div>
    );
  }

  // Gate 1: Not signed in
  if (!authenticated || !user) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--muxaro-bg-base)' }}>
        <div className="max-w-lg mx-auto px-4 py-16">
          <div className="muxaro-card p-8 text-center">
            <div
              className="mx-auto mb-4 w-12 h-12 flex items-center justify-center"
              style={{
                backgroundColor: 'var(--muxaro-bg-elevated)',
                borderRadius: 'var(--muxaro-radius-md)',
                color: 'var(--muxaro-indigo)',
              }}
              aria-hidden="true"
            >
              <Lock className="w-6 h-6" />
            </div>
            <h1
              className="text-2xl font-bold mb-2"
              style={{ color: 'var(--muxaro-text-primary)' }}
            >
              Administrator sign-in required
            </h1>
            <p className="text-sm mb-6" style={{ color: 'var(--muxaro-text-secondary)' }}>
              Sign in with an authorized administrator account to continue.
            </p>
            <Link
              href="/login?returnTo=/admin"
              className="muxaro-btn-primary inline-flex items-center justify-center text-sm font-semibold px-5 py-2.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
              style={{ textDecoration: 'none', borderRadius: 'var(--muxaro-radius-sm)' }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Gate 2: Authenticated non-admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--muxaro-bg-base)' }}>
        <div className="max-w-lg mx-auto px-4 py-16">
          <div className="muxaro-card p-8 text-center">
            <div
              className="mx-auto mb-4 w-12 h-12 flex items-center justify-center"
              style={{
                backgroundColor: 'var(--muxaro-error-bg)',
                borderRadius: 'var(--muxaro-radius-md)',
                color: 'var(--muxaro-error)',
              }}
              aria-hidden="true"
            >
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h1
              className="text-2xl font-bold mb-2"
              style={{ color: 'var(--muxaro-text-primary)' }}
            >
              Access restricted
            </h1>
            <p className="text-sm mb-6" style={{ color: 'var(--muxaro-text-secondary)' }}>
              Administrator privileges are required to view the Control Centre.
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center text-sm font-medium px-5 py-2.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
              style={{
                border: '1px solid var(--muxaro-border)',
                borderRadius: 'var(--muxaro-radius-sm)',
                color: 'var(--muxaro-text-primary)',
                backgroundColor: 'var(--muxaro-bg-surface)',
                textDecoration: 'none',
              }}
            >
              Return home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Gate 3: Admin authenticated but TOTP MFA not verified for current session
  if (!isMfaCleared) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--muxaro-bg-base)' }}>
        <div className="max-w-lg mx-auto px-4 py-16">
          <div className="muxaro-card p-8 space-y-5">
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: 'var(--muxaro-warning-bg)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                  color: 'var(--muxaro-warning)',
                }}
                aria-hidden="true"
              >
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h1
                  className="text-xl font-bold"
                  style={{ color: 'var(--muxaro-text-primary)' }}
                >
                  Verify administrator MFA
                </h1>
                <p
                  className="text-sm mt-1"
                  style={{ color: 'var(--muxaro-text-secondary)' }}
                >
                  Two-factor verification is required before opening administrator controls.
                </p>
              </div>
            </div>

            {mfaError && (
              <p
                className="text-xs px-3 py-2"
                style={{
                  backgroundColor: 'var(--muxaro-error-bg)',
                  color: 'var(--muxaro-error)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                }}
                role="alert"
              >
                {mfaError}
              </p>
            )}

            {!user.mfaEnabled && !mfaSetup && (
              <div className="space-y-3">
                <p className="text-xs" style={{ color: 'var(--muxaro-text-secondary)' }}>
                  Your administrator account does not have an authenticator configured yet. Set up TOTP now to access this session.
                </p>
                <button
                  type="button"
                  onClick={handleStartAdminMfa}
                  disabled={mfaBusy}
                  className="muxaro-btn-primary inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="p-3.5 space-y-2.5"
                style={{
                  backgroundColor: 'var(--muxaro-bg-elevated)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                }}
              >
                <p className="text-xs" style={{ color: 'var(--muxaro-text-secondary)' }}>
                  Add this key to your authenticator app, then verify with a 6-digit code:
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    className="text-xs font-semibold mono-metric px-2.5 py-1 break-all"
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
                    className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
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
              </div>
            )}

            {(user.mfaEnabled || mfaSetup) && (
              <form onSubmit={handleVerifyAdminMfa} className="space-y-3">
                <div>
                  <label
                    htmlFor="admin-mfa-code"
                    className="block text-xs font-medium mb-1"
                    style={{ color: 'var(--muxaro-text-secondary)' }}
                  >
                    Authenticator code
                  </label>
                  <input
                    id="admin-mfa-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="000000"
                    className="w-full px-3 py-2 text-sm mono-metric focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    style={{
                      backgroundColor: 'var(--muxaro-bg-base)',
                      border: '1px solid var(--muxaro-border)',
                      borderRadius: 'var(--muxaro-radius-sm)',
                      color: 'var(--muxaro-text-primary)',
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={mfaBusy}
                  className="muxaro-btn-primary inline-flex items-center justify-center gap-1.5 w-full text-sm font-semibold px-4 py-2.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderRadius: 'var(--muxaro-radius-sm)' }}
                >
                  {mfaBusy && (
                    <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
                  )}
                  <span>Verify session</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    {
      id: 'users',
      label: 'Support & Users',
      icon: <Users className="w-4 h-4" aria-hidden="true" />,
    },
    {
      id: 'settings',
      label: 'Quota & Settings',
      icon: <Settings className="w-4 h-4" aria-hidden="true" />,
    },
    {
      id: 'analytics',
      label: 'Rewards & Analytics',
      icon: <BarChart3 className="w-4 h-4" aria-hidden="true" />,
    },
    {
      id: 'system',
      label: 'System & Audit',
      icon: <Activity className="w-4 h-4" aria-hidden="true" />,
    },
  ];

  const queueClassesMap =
    metrics?.queueClasses && typeof metrics.queueClasses === 'object'
      ? (metrics.queueClasses as Record<
          string,
          { waiting?: number; active?: number; concurrency?: number; completed?: number }
        >)
      : {};

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--muxaro-bg-base)' }}>
      <div className="max-w-sheet mx-auto px-4 md:px-8 py-8 md:py-12 space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield
                className="w-5 h-5"
                style={{ color: 'var(--muxaro-indigo)' }}
                aria-hidden="true"
              />
              <h1
                className="text-2xl sm:text-3xl font-bold"
                style={{
                  color: 'var(--muxaro-text-primary)',
                  letterSpacing: '-0.02em',
                  lineHeight: '1.2',
                }}
              >
                Admin Control Centre
              </h1>
            </div>
            <p className="text-sm" style={{ color: 'var(--muxaro-text-secondary)' }}>
              Live user support, quota governance, reward integrity, and audited system health.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 mono-metric"
              style={{
                backgroundColor: 'var(--muxaro-success-bg)',
                color: 'var(--muxaro-success)',
                borderRadius: 'var(--muxaro-radius-sm)',
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{user.publicUserId}</span>
            </span>
            <button
              type="button"
              onClick={() => loadTabData(activeTab)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                border: '1px solid var(--muxaro-border)',
                borderRadius: 'var(--muxaro-radius-sm)',
                color: 'var(--muxaro-text-secondary)',
                backgroundColor: 'var(--muxaro-bg-surface)',
              }}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{refreshLabel}</span>
            </button>
          </div>
        </header>

        {/* 4 Operational Tabs */}
        <div
          role="tablist"
          aria-label="Administrator sections"
          className="flex flex-wrap items-center gap-2 pb-2"
          style={{ borderBottom: '1px solid var(--muxaro-border)' }}
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium px-3.5 py-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98]"
                style={{
                  backgroundColor: selected
                    ? 'var(--muxaro-info-bg)'
                    : 'transparent',
                  color: selected
                    ? 'var(--muxaro-indigo)'
                    : 'var(--muxaro-text-secondary)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {tabError && (
          <div
            className="flex items-center gap-2 px-4 py-3 text-sm"
            style={{
              backgroundColor: 'var(--muxaro-error-bg)',
              border: '1px solid var(--muxaro-error)',
              borderRadius: 'var(--muxaro-radius-md)',
              color: 'var(--muxaro-text-primary)',
            }}
            role="alert"
          >
            <AlertCircle
              className="w-4 h-4 shrink-0"
              style={{ color: 'var(--muxaro-error)' }}
              aria-hidden="true"
            />
            <span>{tabError}</span>
          </div>
        )}

        {/* TAB 1: Support Search & Users */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <section className="muxaro-card p-6 space-y-4" aria-label="Support lookup">
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                Support lookup
              </h2>
              <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2.5">
                <label htmlFor="admin-support-search" className="sr-only">
                  Search by Public User ID, Batch ID, Job ID, or Request ID
                </label>
                <div className="relative flex-1 min-w-[240px]">
                  <Search
                    className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--muxaro-text-tertiary)' }}
                    aria-hidden="true"
                  />
                  <input
                    id="admin-support-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search MXR-..., MXB-..., MXJ-..., or req_..."
                    className="w-full pl-9 pr-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    style={{
                      backgroundColor: 'var(--muxaro-bg-base)',
                      border: '1px solid var(--muxaro-border)',
                      borderRadius: 'var(--muxaro-radius-sm)',
                      color: 'var(--muxaro-text-primary)',
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching}
                  className="muxaro-btn-primary text-xs font-semibold px-4 py-2.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderRadius: 'var(--muxaro-radius-sm)' }}
                >
                  {searchBtnLabel}
                </button>
                {searchResult && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSearchResult(null);
                    }}
                    className="text-xs font-medium px-3 py-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    style={{ color: 'var(--muxaro-text-secondary)' }}
                  >
                    Clear
                  </button>
                )}
              </form>

              {searchResult && (
                <div
                  className="pt-4 space-y-4"
                  style={{ borderTop: '1px solid var(--muxaro-border-subtle)' }}
                >
                  <p className="text-xs" style={{ color: 'var(--muxaro-text-secondary)' }}>
                    Matches for <code className="mono-metric">{searchResult.query}</code>: {searchResult.users.length} users, {searchResult.batches.length} batches, {searchResult.jobs.length} jobs.
                  </p>

                  {searchResult.batches.length > 0 && (
                    <div className="space-y-1.5">
                      <h3
                        className="text-xs font-semibold"
                        style={{ color: 'var(--muxaro-text-secondary)' }}
                      >
                        Matching batches
                      </h3>
                      {searchResult.batches.map((b) => (
                        <div
                          key={b.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                          style={{
                            backgroundColor: 'var(--muxaro-bg-elevated)',
                            borderRadius: 'var(--muxaro-radius-sm)',
                          }}
                        >
                          <code className="mono-metric font-semibold">{b.batchId || b.id}</code>
                          <span style={{ color: 'var(--muxaro-text-secondary)' }}>
                            {b.completedItems}/{b.totalItems} complete ({b.status})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResult.jobs.length > 0 && (
                    <div className="space-y-1.5">
                      <h3
                        className="text-xs font-semibold"
                        style={{ color: 'var(--muxaro-text-secondary)' }}
                      >
                        Matching jobs
                      </h3>
                      {searchResult.jobs.map((j) => (
                        <div
                          key={j.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                          style={{
                            backgroundColor: 'var(--muxaro-bg-elevated)',
                            borderRadius: 'var(--muxaro-radius-sm)',
                          }}
                        >
                          <code className="mono-metric font-semibold">{j.id}</code>
                          <span style={{ color: 'var(--muxaro-text-secondary)' }}>
                            {j.operation} ({j.status})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* User Directory Table */}
            <section className="muxaro-card p-6 space-y-4" aria-label="User accounts">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  className="text-base font-semibold"
                  style={{ color: 'var(--muxaro-text-primary)' }}
                >
                  {searchResult ? 'Matching users' : 'Registered users'}
                </h2>
                {userActionNotice && (
                  <span
                    className="text-xs font-medium px-2.5 py-1"
                    style={{
                      backgroundColor: 'var(--muxaro-info-bg)',
                      color: 'var(--muxaro-info)',
                      borderRadius: 'var(--muxaro-radius-sm)',
                    }}
                    role="status"
                  >
                    {userActionNotice}
                  </span>
                )}
              </div>

              {(searchResult ? searchResult.users : users).length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muxaro-text-secondary)' }}>
                  No matching user records found.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr
                        className="text-xs"
                        style={{
                          color: 'var(--muxaro-text-tertiary)',
                          borderBottom: '1px solid var(--muxaro-border)',
                        }}
                      >
                        <th className="py-2.5 pr-4 font-medium">Public ID</th>
                        <th className="py-2.5 px-3 font-medium">Account</th>
                        <th className="py-2.5 px-3 font-medium">Tier / Status</th>
                        <th className="py-2.5 px-3 font-medium">Usage / Flags</th>
                        <th className="py-2.5 pl-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(searchResult ? searchResult.users : users).map((u) => {
                        const isSuspended = u.status?.toLowerCase() === 'suspended';
                        return (
                          <tr
                            key={u.id}
                            style={{ borderBottom: '1px solid var(--muxaro-border-subtle)' }}
                          >
                            <td className="py-3 pr-4">
                              <code
                                className="text-xs font-semibold mono-metric"
                                style={{ color: 'var(--muxaro-text-primary)' }}
                              >
                                {u.publicUserId}
                              </code>
                            </td>
                            <td className="py-3 px-3">
                              <p
                                className="font-medium truncate max-w-[200px]"
                                style={{ color: 'var(--muxaro-text-primary)' }}
                              >
                                {u.email}
                              </p>
                              <span
                                className="text-xs"
                                style={{ color: 'var(--muxaro-text-tertiary)' }}
                              >
                                {u.role}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className="text-xs font-medium px-2 py-0.5"
                                  style={{
                                    backgroundColor: 'var(--muxaro-bg-elevated)',
                                    color: 'var(--muxaro-text-secondary)',
                                    borderRadius: 'var(--muxaro-radius-full)',
                                  }}
                                >
                                  {u.tier}
                                </span>
                                <span
                                  className="text-xs font-medium px-2 py-0.5"
                                  style={{
                                    backgroundColor: isSuspended
                                      ? 'var(--muxaro-error-bg)'
                                      : 'var(--muxaro-success-bg)',
                                    color: isSuspended
                                      ? 'var(--muxaro-error)'
                                      : 'var(--muxaro-success)',
                                    borderRadius: 'var(--muxaro-radius-full)',
                                  }}
                                >
                                  {u.status}
                                </span>
                              </div>
                            </td>
                            <td
                              className="py-3 px-3 text-xs mono-metric"
                              style={{ color: 'var(--muxaro-text-secondary)' }}
                            >
                              {u.usageSummary
                                ? `${u.usageSummary.baseRemaining ?? 0} base, +${u.usageSummary.extraCreditsRemaining ?? 0} extra`
                                : 'Active'}
                              {typeof u.abuseFlags === 'number' && u.abuseFlags > 0 && (
                                <span
                                  className="ml-2 px-1.5 py-0.5"
                                  style={{
                                    backgroundColor: 'var(--muxaro-warning-bg)',
                                    color: 'var(--muxaro-warning)',
                                    borderRadius: 'var(--muxaro-radius-sm)',
                                  }}
                                >
                                  {u.abuseFlags} flags
                                </span>
                              )}
                            </td>
                            <td className="py-3 pl-3">
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                {isSuspended ? (
                                  <button
                                    type="button"
                                    disabled={userActionBusy === `restore:${u.id}`}
                                    onClick={() => handleUserAction(u, 'restore')}
                                    className="text-xs font-medium px-2.5 py-1 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                                    style={{
                                      border: '1px solid var(--muxaro-border)',
                                      borderRadius: 'var(--muxaro-radius-sm)',
                                      color: 'var(--muxaro-success)',
                                      backgroundColor: 'var(--muxaro-bg-surface)',
                                    }}
                                  >
                                    Restore
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={userActionBusy === `suspend:${u.id}`}
                                    onClick={() => handleUserAction(u, 'suspend')}
                                    className="text-xs font-medium px-2.5 py-1 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                                    style={{
                                      border: '1px solid var(--muxaro-border)',
                                      borderRadius: 'var(--muxaro-radius-sm)',
                                      color: 'var(--muxaro-error)',
                                      backgroundColor: 'var(--muxaro-bg-surface)',
                                    }}
                                  >
                                    Suspend
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={userActionBusy === `revoke:${u.id}`}
                                  onClick={() => handleUserAction(u, 'revoke')}
                                  className="text-xs font-medium px-2.5 py-1 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                                  style={{
                                    border: '1px solid var(--muxaro-border)',
                                    borderRadius: 'var(--muxaro-radius-sm)',
                                    color: 'var(--muxaro-text-secondary)',
                                    backgroundColor: 'var(--muxaro-bg-surface)',
                                  }}
                                >
                                  Revoke sessions
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: Quota & Platform Settings */}
        {activeTab === 'settings' && (
          <section className="muxaro-card p-6 space-y-5" aria-label="Platform settings">
            <div>
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                Quota and platform settings
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muxaro-text-secondary)' }}>
                Changes take effect immediately and are recorded in the immutable audit log.
              </p>
            </div>

            {settingsNotice && (
              <p
                className="text-xs px-3 py-2"
                style={{
                  backgroundColor:
                    settingsNotice.kind === 'success'
                      ? 'var(--muxaro-success-bg)'
                      : 'var(--muxaro-error-bg)',
                  color:
                    settingsNotice.kind === 'success'
                      ? 'var(--muxaro-success)'
                      : 'var(--muxaro-error)',
                  borderRadius: 'var(--muxaro-radius-sm)',
                }}
                role="status"
              >
                {settingsNotice.text}
              </p>
            )}

            {!settings ? (
              <div className="h-48 motion-safe:animate-pulse" aria-hidden="true" />
            ) : (
              <form onSubmit={handleSaveSettings} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { key: 'baseVideoAllowance', label: 'Base video allowance (24h)' },
                    { key: 'playlistAllowance', label: 'Playlist allowance (24h)' },
                    { key: 'rewardCreditsPerAd', label: 'Reward credits per ad' },
                    { key: 'rewardDailyCap', label: 'Reward daily ad cap' },
                    { key: 'rewardExpiryHours', label: 'Reward expiry (hours)' },
                    { key: 'guestConcurrency', label: 'Guest concurrency cap' },
                    { key: 'freeConcurrency', label: 'Free concurrency cap' },
                    { key: 'premiumConcurrency', label: 'Premium concurrency cap' },
                    { key: 'maxUploadSizeMb', label: 'Max upload size (MB)' },
                    { key: 'maxPlaylistItems', label: 'Max playlist items' },
                  ].map((field) => (
                    <div key={field.key}>
                      <label
                        htmlFor={`setting-${field.key}`}
                        className="block text-xs font-medium mb-1"
                        style={{ color: 'var(--muxaro-text-secondary)' }}
                      >
                        {field.label}
                      </label>
                      <input
                        id={`setting-${field.key}`}
                        type="number"
                        min={0}
                        value={Number(settings[field.key] ?? 0)}
                        onChange={(e) =>
                          updateSettingNumber(
                            field.key as keyof AdminPlatformSettings,
                            e.target.value
                          )
                        }
                        className="w-full px-3 py-2 text-sm mono-metric focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        style={{
                          backgroundColor: 'var(--muxaro-bg-base)',
                          border: '1px solid var(--muxaro-border)',
                          borderRadius: 'var(--muxaro-radius-sm)',
                          color: 'var(--muxaro-text-primary)',
                        }}
                      />
                    </div>
                  ))}
                </div>

                <label className="inline-flex items-center gap-2.5 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.rewardedAdsEnabled)}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, rewardedAdsEnabled: e.target.checked } : prev
                      )
                    }
                    className="w-4 h-4"
                  />
                  <span style={{ color: 'var(--muxaro-text-primary)' }}>
                    Enable optional rewarded advertisements (requires configured provider)
                  </span>
                </label>

                <div>
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="muxaro-btn-primary inline-flex items-center gap-1.5 text-sm font-semibold px-5 py-2.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderRadius: 'var(--muxaro-radius-sm)' }}
                  >
                    {savingSettings && (
                      <Loader2
                        className="w-4 h-4 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    <span>{saveSettingsLabel}</span>
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* TAB 3: Rewards & Analytics */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Rewards Summary */}
            <section className="muxaro-card p-6 space-y-4" aria-label="Rewarded ads metrics">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  className="text-base font-semibold"
                  style={{ color: 'var(--muxaro-text-primary)' }}
                >
                  Rewarded ads and fraud protection
                </h2>
                {rewards && (
                  <span
                    className="text-xs font-medium px-2.5 py-0.5"
                    style={{
                      backgroundColor:
                        rewards.enabled && rewards.configured
                          ? 'var(--muxaro-success-bg)'
                          : 'var(--muxaro-bg-elevated)',
                      color:
                        rewards.enabled && rewards.configured
                          ? 'var(--muxaro-success)'
                          : 'var(--muxaro-text-secondary)',
                      borderRadius: 'var(--muxaro-radius-full)',
                    }}
                  >
                    {rewards.configured
                      ? rewards.enabled
                        ? 'Provider active'
                        : 'Configured (paused)'
                      : 'Provider not configured'}
                  </span>
                )}
              </div>

              {!rewards ? (
                <div className="h-24 motion-safe:animate-pulse" aria-hidden="true" />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Verified rewards', value: formatNumber(rewards.verifiedRewards) },
                    { label: 'Rejected claims', value: formatNumber(rewards.rejectedRewards) },
                    { label: 'Duplicate replays', value: formatNumber(rewards.duplicateReplays) },
                    { label: 'Fraud flags', value: formatNumber(rewards.fraudFlags) },
                  ].map((item) => (
                    <div key={item.label}>
                      <span
                        className="block text-xs mb-1"
                        style={{ color: 'var(--muxaro-text-secondary)' }}
                      >
                        {item.label}
                      </span>
                      <p
                        className="text-xl font-bold mono-metric"
                        style={{ color: 'var(--muxaro-text-primary)' }}
                      >
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Platform Analytics & Tier Queue Wait */}
            <section className="muxaro-card p-6 space-y-5" aria-label="Platform analytics">
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                Platform analytics and queue latency
              </h2>

              {!analytics ? (
                <div className="h-32 motion-safe:animate-pulse" aria-hidden="true" />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: 'Daily active users', value: formatNumber(analytics.dau) },
                      { label: 'Monthly active users', value: formatNumber(analytics.mau) },
                      { label: 'Registrations (24h)', value: formatNumber(analytics.registrations24h) },
                      {
                        label: 'Processing success rate',
                        value: `${Number(analytics.processingSuccessRate ?? 0).toFixed(1)}%`,
                      },
                    ].map((metric) => (
                      <div key={metric.label}>
                        <span
                          className="block text-xs mb-1"
                          style={{ color: 'var(--muxaro-text-secondary)' }}
                        >
                          {metric.label}
                        </span>
                        <p
                          className="text-xl font-bold mono-metric"
                          style={{ color: 'var(--muxaro-text-primary)' }}
                        >
                          {metric.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Per-tier queue wait times */}
                  <div
                    className="pt-4 space-y-2.5"
                    style={{ borderTop: '1px solid var(--muxaro-border-subtle)' }}
                  >
                    <h3
                      className="text-xs font-semibold"
                      style={{ color: 'var(--muxaro-text-secondary)' }}
                    >
                      Measured queue wait by tier
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {(['guest', 'registered', 'premium'] as const).map((tierKey) => {
                        const stats = analytics.queueWaitByTier?.[tierKey];
                        return (
                          <div
                            key={tierKey}
                            className="px-3.5 py-3"
                            style={{
                              backgroundColor: 'var(--muxaro-bg-elevated)',
                              borderRadius: 'var(--muxaro-radius-sm)',
                            }}
                          >
                            <span
                              className="block text-xs font-semibold capitalize mb-1"
                              style={{ color: 'var(--muxaro-text-primary)' }}
                            >
                              {tierKey}
                            </span>
                            <p
                              className="text-xs mono-metric"
                              style={{ color: 'var(--muxaro-text-secondary)' }}
                            >
                              p50: {formatMs(stats?.p50Ms)} | p95: {formatMs(stats?.p95Ms)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Conversion funnel & retention */}
                  {(analytics.conversionFunnel || analytics.retention) && (
                    <div
                      className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4"
                      style={{ borderTop: '1px solid var(--muxaro-border-subtle)' }}
                    >
                      {analytics.conversionFunnel && (
                        <div>
                          <h3
                            className="text-xs font-semibold mb-2"
                            style={{ color: 'var(--muxaro-text-secondary)' }}
                          >
                            Conversion funnel
                          </h3>
                          <dl className="space-y-1.5 text-xs">
                            {Object.entries(analytics.conversionFunnel).map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-2">
                                <dt style={{ color: 'var(--muxaro-text-secondary)' }}>{k}</dt>
                                <dd
                                  className="mono-metric font-semibold"
                                  style={{ color: 'var(--muxaro-text-primary)' }}
                                >
                                  {formatNumber(v)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}

                      {analytics.retention && (
                        <div>
                          <h3
                            className="text-xs font-semibold mb-2"
                            style={{ color: 'var(--muxaro-text-secondary)' }}
                          >
                            Retention metrics
                          </h3>
                          <dl className="space-y-1.5 text-xs">
                            {Object.entries(analytics.retention).map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-2">
                                <dt style={{ color: 'var(--muxaro-text-secondary)' }}>{k}</dt>
                                <dd
                                  className="mono-metric font-semibold"
                                  style={{ color: 'var(--muxaro-text-primary)' }}
                                >
                                  {typeof v === 'number' ? `${v.toFixed(1)}%` : String(v)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: System Health & Audit Logs */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            {/* 6-Class Queue Health */}
            <section className="muxaro-card p-6 space-y-4" aria-label="Queue health">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  className="text-base font-semibold"
                  style={{ color: 'var(--muxaro-text-primary)' }}
                >
                  Queue health across 6 processing classes
                </h2>
                {metrics && (
                  <span
                    className="text-xs font-medium px-2.5 py-0.5 mono-metric"
                    style={{
                      backgroundColor: 'var(--muxaro-success-bg)',
                      color: 'var(--muxaro-success)',
                      borderRadius: 'var(--muxaro-radius-full)',
                    }}
                  >
                    {metrics.status}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {QUEUE_CLASS_NAMES.map((cls) => {
                  const lane = queueClassesMap[cls];
                  return (
                    <div
                      key={cls}
                      className="px-3.5 py-3"
                      style={{
                        backgroundColor: 'var(--muxaro-bg-elevated)',
                        borderRadius: 'var(--muxaro-radius-sm)',
                      }}
                    >
                      <code
                        className="block text-xs font-semibold mono-metric mb-1"
                        style={{ color: 'var(--muxaro-text-primary)' }}
                      >
                        {cls}
                      </code>
                      <p
                        className="text-xs mono-metric"
                        style={{ color: 'var(--muxaro-text-secondary)' }}
                      >
                        Active: {lane?.active ?? 0} | Waiting: {lane?.waiting ?? 0}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Security Events */}
            <section className="muxaro-card p-6 space-y-4" aria-label="Security events">
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                Recent security events
              </h2>
              {securityEvents.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muxaro-text-secondary)' }}>
                  No security events recorded.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr
                        style={{
                          color: 'var(--muxaro-text-tertiary)',
                          borderBottom: '1px solid var(--muxaro-border)',
                        }}
                      >
                        <th className="py-2 pr-3 font-medium">Time</th>
                        <th className="py-2 px-3 font-medium">Event</th>
                        <th className="py-2 px-3 font-medium">Severity</th>
                        <th className="py-2 pl-3 font-medium">Context</th>
                      </tr>
                    </thead>
                    <tbody>
                      {securityEvents.map((ev) => (
                        <tr
                          key={ev.id}
                          style={{ borderBottom: '1px solid var(--muxaro-border-subtle)' }}
                        >
                          <td
                            className="py-2.5 pr-3 whitespace-nowrap"
                            style={{ color: 'var(--muxaro-text-secondary)' }}
                          >
                            {ev.timestamp ? formatUtcTimestamp(ev.timestamp) : '-'}
                          </td>
                          <td className="py-2.5 px-3 mono-metric font-medium">
                            {ev.eventType}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className="px-2 py-0.5 font-medium"
                              style={{
                                backgroundColor:
                                  ev.severity === 'high' || ev.severity === 'critical'
                                    ? 'var(--muxaro-error-bg)'
                                    : 'var(--muxaro-warning-bg)',
                                color:
                                  ev.severity === 'high' || ev.severity === 'critical'
                                    ? 'var(--muxaro-error)'
                                    : 'var(--muxaro-warning)',
                                borderRadius: 'var(--muxaro-radius-full)',
                              }}
                            >
                              {ev.severity}
                            </span>
                          </td>
                          <td
                            className="py-2.5 pl-3"
                            style={{ color: 'var(--muxaro-text-secondary)' }}
                          >
                            {ev.message || ev.publicUserId || ev.ipPrefix || ev.requestId || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Immutable Admin Audit Trail */}
            <section className="muxaro-card p-6 space-y-4" aria-label="Administrator audit trail">
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--muxaro-text-primary)' }}
              >
                Immutable administrator audit log
              </h2>
              {auditLogs.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muxaro-text-secondary)' }}>
                  No administrator actions logged yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr
                        style={{
                          color: 'var(--muxaro-text-tertiary)',
                          borderBottom: '1px solid var(--muxaro-border)',
                        }}
                      >
                        <th className="py-2 pr-3 font-medium">Time</th>
                        <th className="py-2 px-3 font-medium">Actor</th>
                        <th className="py-2 px-3 font-medium">Action</th>
                        <th className="py-2 pl-3 font-medium">Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr
                          key={log.id}
                          style={{ borderBottom: '1px solid var(--muxaro-border-subtle)' }}
                        >
                          <td
                            className="py-2.5 pr-3 whitespace-nowrap"
                            style={{ color: 'var(--muxaro-text-secondary)' }}
                          >
                            {log.timestamp ? formatUtcTimestamp(log.timestamp) : '-'}
                          </td>
                          <td className="py-2.5 px-3 mono-metric">
                            {log.actorPublicId || log.actorUserId || 'admin'}
                          </td>
                          <td className="py-2.5 px-3 mono-metric font-medium">
                            {log.action}
                          </td>
                          <td
                            className="py-2.5 pl-3 mono-metric"
                            style={{ color: 'var(--muxaro-text-secondary)' }}
                          >
                            {log.targetType ? `${log.targetType}: ${log.targetId || ''}` : log.targetId || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
