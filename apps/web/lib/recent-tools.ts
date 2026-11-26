'use client';

const RECENT_KEY = 'muxaro_recent_tools_v1';
const PINNED_KEY = 'muxaro_pinned_tools_v1';
const MAX_RECENT = 8;

function readHrefList(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.startsWith('/'))
      : [];
  } catch {
    return [];
  }
}

export function getRecentToolHrefs(): string[] {
  return readHrefList(RECENT_KEY);
}

export function getPinnedToolHrefs(): string[] {
  return readHrefList(PINNED_KEY);
}

export function recordRecentTool(href: string): string[] {
  if (typeof window === 'undefined' || !href.startsWith('/')) return [];
  const next = [href, ...readHrefList(RECENT_KEY).filter((h) => h !== href)].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function togglePinnedTool(href: string): string[] {
  if (typeof window === 'undefined' || !href.startsWith('/')) return [];
  const current = readHrefList(PINNED_KEY);
  const exists = current.includes(href);
  const next = exists ? current.filter((h) => h !== href) : [href, ...current].slice(0, 8);
  try {
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(next));
  } catch {}
  return next;
}
