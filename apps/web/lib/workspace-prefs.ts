'use client';

import { useCallback, useEffect, useState } from 'react';

export type WorkspaceViewMode = 'cards' | 'compact';
export type WorkspaceSortMode = 'category' | 'az';

export interface WorkspacePreferences {
  viewMode: WorkspaceViewMode;
  sortMode: WorkspaceSortMode;
  fullWidth: boolean;
  toolRailOpen: boolean;
}

const PREFS_KEY = 'muxaro_workspace_prefs_v1';
const PREFS_EVENT = 'muxaro:workspace-prefs';

export const DEFAULT_WORKSPACE_PREFS: WorkspacePreferences = {
  viewMode: 'cards',
  sortMode: 'category',
  fullWidth: false,
  toolRailOpen: true,
};

export function readWorkspacePrefs(): WorkspacePreferences {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_WORKSPACE_PREFS;
    const parsed = JSON.parse(raw) as Partial<WorkspacePreferences>;
    return {
      viewMode: parsed.viewMode === 'compact' ? 'compact' : 'cards',
      sortMode: parsed.sortMode === 'az' ? 'az' : 'category',
      fullWidth: Boolean(parsed.fullWidth),
      toolRailOpen: parsed.toolRailOpen !== false,
    };
  } catch {
    return DEFAULT_WORKSPACE_PREFS;
  }
}

export function writeWorkspacePrefs(next: WorkspacePreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
  } catch {}
}

/**
 * Shared persisted workspace display preferences (Cards vs Compact, A-Z vs Category,
 * Full-Width mode, and collapsible Tool Rail) synchronized across tabs & components.
 */
export function useWorkspacePrefs() {
  const [prefs, setPrefs] = useState<WorkspacePreferences>(DEFAULT_WORKSPACE_PREFS);

  useEffect(() => {
    setPrefs(readWorkspacePrefs());
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<WorkspacePreferences>).detail;
      if (detail) setPrefs(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY) setPrefs(readWorkspacePrefs());
    };
    window.addEventListener(PREFS_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PREFS_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const updatePrefs = useCallback(
    (patch: Partial<WorkspacePreferences> | ((prev: WorkspacePreferences) => WorkspacePreferences)) => {
      setPrefs((prev) => {
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        writeWorkspacePrefs(next);
        return next;
      });
    },
    []
  );

  return { prefs, updatePrefs };
}
