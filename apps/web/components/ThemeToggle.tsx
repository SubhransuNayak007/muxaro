'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Sun, Moon } from 'lucide-react';

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const [isDark, setIsDark] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  // Initialize theme from DOM classList and localStorage
  useEffect(() => {
    const root = document.documentElement;
    const stored = typeof window !== 'undefined' ? localStorage.getItem('theme') : null;
    const isDarkMode =
      root.classList.contains('dark') ||
      root.getAttribute('data-theme') === 'dark' ||
      stored === 'dark' ||
      (!stored && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

    setIsDark(isDarkMode);
    setMounted(true);

    const handleThemeChange = (e?: Event) => {
      const customEvent = e as CustomEvent<{ theme?: string }> | undefined;
      const themeVal = customEvent?.detail?.theme || localStorage.getItem('theme');
      if (themeVal === 'dark') {
        setIsDark(true);
      } else if (themeVal === 'light') {
        setIsDark(false);
      } else {
        setIsDark(root.classList.contains('dark'));
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'theme') {
        handleThemeChange();
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('muxaro-theme-changed', handleThemeChange);
    window.addEventListener('muxaro-settings-changed', handleThemeChange);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('muxaro-theme-changed', handleThemeChange);
      window.removeEventListener('muxaro-settings-changed', handleThemeChange);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      const root = document.documentElement;
      const themeVal = next ? 'dark' : 'light';

      if (next) {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
      }

      try {
        localStorage.setItem('theme', themeVal);
        // Synchronize with settings store if existing settings exist
        const raw = localStorage.getItem('muxaro_user_settings');
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.theme = themeVal;
          localStorage.setItem('muxaro_user_settings', JSON.stringify(parsed));
        }
        window.dispatchEvent(
          new CustomEvent('muxaro-theme-changed', { detail: { theme: themeVal } })
        );
      } catch {}

      return next;
    });
  }, []);

  // When dark: button action is "Switch to light theme"
  // When light: button action is "Switch to dark theme"
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
      className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-lg border border-line bg-surface hover:bg-surface-muted text-content-secondary hover:text-content transition-colors active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${className}`}
    >
      {mounted && isDark ? (
        <Sun className="w-4 h-4 text-warning" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4 text-content-secondary" aria-hidden="true" />
      )}
    </button>
  );
}

export default ThemeToggle;
