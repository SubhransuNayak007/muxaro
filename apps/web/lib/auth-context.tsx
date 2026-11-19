'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAnalyticsUserId, trackEvent } from './analytics';
import { getApiBaseUrl } from './api-client';

const PENDING_TASK_STORAGE_KEY = 'muxaro-pending-task';
const PENDING_TASK_TTL_MS = 30 * 60 * 1000;

export interface AuthUser {
  id?: string;
  internalUserId?: string;
  publicUserId: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'user' | 'admin' | 'super_admin' | string;
  tier: 'guest' | 'free' | 'registered' | 'premium' | string;
  mfaEnabled: boolean;
  mfaVerified: boolean;
}

export interface PendingTaskState {
  url?: string;
  mode?: 'video' | 'audio' | 'merge';
  resolution?: string;
  format?: string;
  returnTo?: string;
  savedAt: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  authenticated: boolean;
  loading: boolean;
  csrfToken: string | null;
  googleAuthConfigured: boolean;
  refreshSession: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  savePendingTask: (task: Omit<PendingTaskState, 'savedAt'>) => void;
  consumePendingTask: () => PendingTaskState | null;
}

interface RawSessionResponse {
  authenticated?: boolean;
  csrfToken?: string | null;
  googleAuthConfigured?: boolean;
  user?: Partial<AuthUser> | null;
  id?: string;
  internalUserId?: string;
  publicUserId?: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
  role?: string;
  tier?: string;
  mfaEnabled?: boolean;
  mfaVerified?: boolean;
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith('muxaro_csrf=')) {
      try {
        return decodeURIComponent(trimmed.slice('muxaro_csrf='.length));
      } catch {
        return trimmed.slice('muxaro_csrf='.length);
      }
    }
  }
  return null;
}

function normalizeAuthUser(raw: RawSessionResponse): AuthUser | null {
  if (!raw || raw.authenticated !== true) return null;
  const source = raw.user && typeof raw.user === 'object' ? raw.user : raw;
  const publicUserId = typeof source.publicUserId === 'string' ? source.publicUserId.trim() : '';
  const email = typeof source.email === 'string' ? source.email.trim() : '';
  if (!publicUserId && !email) return null;

  return {
    id: typeof source.id === 'string' ? source.id : undefined,
    internalUserId: typeof source.internalUserId === 'string' ? source.internalUserId : undefined,
    publicUserId: publicUserId || 'MXR-ACCOUNT',
    email,
    emailVerified: Boolean(source.emailVerified),
    displayName: typeof source.displayName === 'string' ? source.displayName : null,
    avatarUrl: typeof source.avatarUrl === 'string' ? source.avatarUrl : null,
    role: typeof source.role === 'string' ? source.role : 'user',
    tier: typeof source.tier === 'string' ? source.tier : 'free',
    mfaEnabled: Boolean(source.mfaEnabled),
    mfaVerified: Boolean(source.mfaVerified),
  };
}

function getOpaqueAnalyticsId(user: AuthUser | null): string | null {
  if (!user) return null;
  const candidate = user.internalUserId || user.id || user.publicUserId;
  return candidate && candidate.trim().length > 0 ? candidate.trim() : null;
}

function savePendingTaskImpl(task: Omit<PendingTaskState, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PendingTaskState = {
      url: typeof task.url === 'string' ? task.url.slice(0, 2048) : undefined,
      mode: task.mode,
      resolution: typeof task.resolution === 'string' ? task.resolution.slice(0, 32) : undefined,
      format: typeof task.format === 'string' ? task.format.slice(0, 16) : undefined,
      returnTo:
        typeof task.returnTo === 'string' && task.returnTo.startsWith('/') && !task.returnTo.startsWith('//')
          ? task.returnTo
          : undefined,
      savedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(PENDING_TASK_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore sessionStorage restrictions
  }
}

function consumePendingTaskImpl(): PendingTaskState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_TASK_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_TASK_STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<PendingTaskState>;
    if (!parsed || typeof parsed !== 'object') return null;
    const savedMs = typeof parsed.savedAt === 'string' ? Date.parse(parsed.savedAt) : NaN;
    if (!Number.isFinite(savedMs) || Date.now() - savedMs > PENDING_TASK_TTL_MS) {
      return null;
    }
    return {
      url: typeof parsed.url === 'string' ? parsed.url : undefined,
      mode:
        parsed.mode === 'video' || parsed.mode === 'audio' || parsed.mode === 'merge'
          ? parsed.mode
          : undefined,
      resolution: typeof parsed.resolution === 'string' ? parsed.resolution : undefined,
      format: typeof parsed.format === 'string' ? parsed.format : undefined,
      returnTo: typeof parsed.returnTo === 'string' ? parsed.returnTo : undefined,
      savedAt: parsed.savedAt as string,
    };
  } catch {
    return null;
  }
}

const DEFAULT_AUTH_CONTEXT: AuthContextValue = {
  user: null,
  authenticated: false,
  loading: false,
  csrfToken: null,
  googleAuthConfigured: false,
  refreshSession: async () => null,
  logout: async () => {},
  logoutAll: async () => {},
  savePendingTask: savePendingTaskImpl,
  consumePendingTask: consumePendingTaskImpl,
};

const AuthContext = createContext<AuthContextValue>(DEFAULT_AUTH_CONTEXT);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [googleAuthConfigured, setGoogleAuthConfigured] = useState(false);

  const refreshSession = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/session`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        setUser(null);
        setCsrfToken(readCsrfCookie());
        setAnalyticsUserId(null);
        return null;
      }

      const data = (await response.json()) as RawSessionResponse;
      const nextUser = normalizeAuthUser(data);
      const nextCsrf =
        typeof data.csrfToken === 'string' && data.csrfToken.length > 0
          ? data.csrfToken
          : readCsrfCookie();

      setUser(nextUser);
      setCsrfToken(nextCsrf);
      setGoogleAuthConfigured(Boolean(data.googleAuthConfigured));
      setAnalyticsUserId(getOpaqueAnalyticsId(nextUser));

      return nextUser;
    } catch {
      setUser(null);
      setCsrfToken(readCsrfCookie());
      setAnalyticsUserId(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const performLogout = useCallback(
    async (endpoint: '/auth/logout' | '/auth/logout-all') => {
      const activeCsrf = csrfToken || readCsrfCookie();
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (activeCsrf) {
        headers['x-muxaro-csrf'] = activeCsrf;
      }

      try {
        await fetch(`${getApiBaseUrl()}${endpoint}`, {
          method: 'POST',
          credentials: 'include',
          headers,
        });
      } catch {
        // Proceed with clearing client state even if network failed
      } finally {
        setUser(null);
        setCsrfToken(null);
        setAnalyticsUserId(null);
        trackEvent('auth_logout', {
          scope: endpoint === '/auth/logout-all' ? 'all_sessions' : 'current_session',
        });
      }
    },
    [csrfToken]
  );

  const logout = useCallback(() => performLogout('/auth/logout'), [performLogout]);
  const logoutAll = useCallback(() => performLogout('/auth/logout-all'), [performLogout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      authenticated: user !== null,
      loading,
      csrfToken,
      googleAuthConfigured,
      refreshSession,
      logout,
      logoutAll,
      savePendingTask: savePendingTaskImpl,
      consumePendingTask: consumePendingTaskImpl,
    }),
    [user, loading, csrfToken, googleAuthConfigured, refreshSession, logout, logoutAll]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
