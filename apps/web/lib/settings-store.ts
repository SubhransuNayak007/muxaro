'use client';

import { useState, useEffect, useCallback } from 'react';

export type MuxaroTheme = 'auto' | 'light' | 'dark';
export type VideoQuality = 'auto' | '1080p' | '1440p' | '2160p' | '4320p';
export type VideoCodec = 'auto' | 'h264' | 'av1' | 'vp9';
export type ContainerFormat = 'auto' | 'mp4' | 'mkv' | 'webm';
export type AudioFormat = 'mp3' | 'flac' | 'm4a' | 'opus' | 'wav';
export type AudioBitrate = '320' | '256' | '192' | '128';
export type FilenameTemplate = 'title' | 'title_artist' | 'title_id';
export type StreamChunkSize = '1' | '4' | '8' | '16';
export type RequestTimeout = '30' | '60' | '120' | '300';

export interface MuxaroUserSettings {
  // Appearance
  theme: MuxaroTheme;
  autoLanguage: boolean;
  preferredLanguage: string;

  // Accessibility
  highContrast: boolean;
  reduceMotion: boolean;

  // Video
  videoQuality: VideoQuality;
  videoCodec: VideoCodec;
  containerFormat: ContainerFormat;
  muteVideo: boolean;

  // Audio
  audioFormat: AudioFormat;
  audioBitrate: AudioBitrate;

  // Metadata
  embedThumbnail: boolean;
  filenameTemplate: FilenameTemplate;

  // Local Processing
  enableWasmMuxing: boolean;

  // Instances
  customWorkerUrl: string;

  // Advanced
  streamChunkSize: StreamChunkSize;
  requestTimeout: RequestTimeout;
}

export const DEFAULT_MUXARO_SETTINGS: MuxaroUserSettings = {
  theme: 'auto',
  autoLanguage: true,
  preferredLanguage: 'english',
  highContrast: false,
  reduceMotion: false,
  videoQuality: 'auto',
  videoCodec: 'auto',
  containerFormat: 'auto',
  muteVideo: false,
  audioFormat: 'mp3',
  audioBitrate: '320',
  embedThumbnail: true,
  filenameTemplate: 'title',
  enableWasmMuxing: true,
  customWorkerUrl: '',
  streamChunkSize: '4',
  requestTimeout: '60',
};

const STORAGE_KEY = 'muxaro_user_settings';
const LEGACY_STORAGE_KEY = 'muxaro_cobalt_settings';
const WORKER_STORAGE_KEY = 'muxaro_custom_worker_url';
const THEME_STORAGE_KEY = 'theme';

function applyThemeSetting(theme: MuxaroTheme) {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;

  let isDark = false;
  if (theme === 'auto') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    isDark = theme === 'dark';
  }

  if (isDark) {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  } else {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
  }
}

export function loadStoredSettings(): MuxaroUserSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_MUXARO_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
    const existingWorker = window.localStorage.getItem(WORKER_STORAGE_KEY) || '';
    const existingTheme = (window.localStorage.getItem(THEME_STORAGE_KEY) as MuxaroTheme) || 'auto';

    let parsed: Partial<MuxaroUserSettings> = {};
    if (raw) {
      parsed = JSON.parse(raw);
    }

    return {
      ...DEFAULT_MUXARO_SETTINGS,
      ...parsed,
      theme: parsed.theme || existingTheme || 'auto',
      customWorkerUrl: parsed.customWorkerUrl !== undefined ? parsed.customWorkerUrl : existingWorker,
    };
  } catch {
    return DEFAULT_MUXARO_SETTINGS;
  }
}

export function saveSettings(settings: MuxaroUserSettings): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Keep legacy key synced for backward compatibility
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(settings));

    // Sync worker URL
    if (settings.customWorkerUrl.trim()) {
      window.localStorage.setItem(WORKER_STORAGE_KEY, settings.customWorkerUrl.trim());
    } else {
      window.localStorage.removeItem(WORKER_STORAGE_KEY);
    }

    applyThemeSetting(settings.theme);

    // Broadcast across windows/tabs
    window.dispatchEvent(
      new CustomEvent('muxaro-settings-changed', { detail: settings })
    );
  } catch {}
}

export function useMuxaroSettings() {
  const [settings, setSettings] = useState<MuxaroUserSettings>(DEFAULT_MUXARO_SETTINGS);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    const current = loadStoredSettings();
    setSettings(current);
    applyThemeSetting(current.theme);
    setMounted(true);

    const handleExternalChange = (e: Event) => {
      const customEvent = e as CustomEvent<MuxaroUserSettings>;
      if (customEvent.detail) {
        setSettings(customEvent.detail);
      } else {
        setSettings(loadStoredSettings());
      }
    };

    window.addEventListener('muxaro-settings-changed', handleExternalChange);
    window.addEventListener('storage', handleExternalChange);

    return () => {
      window.removeEventListener('muxaro-settings-changed', handleExternalChange);
      window.removeEventListener('storage', handleExternalChange);
    };
  }, []);

  const updateSettings = useCallback(
    <K extends keyof MuxaroUserSettings>(key: K, value: MuxaroUserSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        saveSettings(next);
        return next;
      });
    },
    []
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_MUXARO_SETTINGS);
    saveSettings(DEFAULT_MUXARO_SETTINGS);
  }, []);

  return {
    settings,
    mounted,
    updateSettings,
    resetSettings,
  };
}

// Aliases for compatibility
export type CobaltTheme = MuxaroTheme;
export type CobaltSettings = MuxaroUserSettings;
export const DEFAULT_COBALT_SETTINGS = DEFAULT_MUXARO_SETTINGS;
export const useCobaltSettings = useMuxaroSettings;
export const loadStoredCobaltSettings = loadStoredSettings;
export const saveCobaltSettings = saveSettings;
