'use client';

/**
 * Project MUXARO - Eco Mode Preference Manager
 * LocalStorage persistence for guest users, cloud-synced for authenticated users.
 * Automatically coordinates energy-saving preferences, stream copy priority,
 * battery-aware throttling, and estimated carbon savings metrics.
 */

import { useState, useEffect, useCallback } from 'react';

export interface EcoSettings {
  enabled: boolean;
  preferStreamCopy: boolean;
  hardwareAcceleration: boolean;
  energySaverBitrate: boolean;
  autoThrottleBattery: boolean;
  maxResolution: 'source' | '1080p' | '720p' | '480p';
  estimatedCarbonSavedGrams: number;
  jobsProcessedEco: number;
  isBatteryThrottling: boolean;
  lastSyncedAt?: number;
}

const STORAGE_KEY = 'muxaro_eco_settings_v1';

const DEFAULT_ECO_SETTINGS: EcoSettings = {
  enabled: true, // Default to eco-friendly stream copy
  preferStreamCopy: true,
  hardwareAcceleration: true,
  energySaverBitrate: false,
  autoThrottleBattery: true,
  maxResolution: 'source',
  estimatedCarbonSavedGrams: 0,
  jobsProcessedEco: 0,
  isBatteryThrottling: false,
};

type EcoListener = (settings: EcoSettings) => void;
const listeners = new Set<EcoListener>();

let currentSettings: EcoSettings = { ...DEFAULT_ECO_SETTINGS };
let isInitialized = false;

function notifyListeners(): void {
  listeners.forEach((listener) => {
    try {
      listener(currentSettings);
    } catch (err) {
      console.error('[EcoStore] listener error:', err);
    }
  });
}

function saveToLocalStorage(settings: EcoSettings): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify({
      enabled: settings.enabled,
      preferStreamCopy: settings.preferStreamCopy,
      hardwareAcceleration: settings.hardwareAcceleration,
      energySaverBitrate: settings.energySaverBitrate,
      autoThrottleBattery: settings.autoThrottleBattery,
      maxResolution: settings.maxResolution,
      estimatedCarbonSavedGrams: settings.estimatedCarbonSavedGrams,
      jobsProcessedEco: settings.jobsProcessedEco,
      lastSyncedAt: Date.now(),
    });
    localStorage.setItem(STORAGE_KEY, payload);
  } catch (err) {
    console.warn('[EcoStore] Failed to save settings to localStorage:', err);
  }
}

function loadFromLocalStorage(): Partial<EcoSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function syncWithServerIfAuthenticated(settings: EcoSettings): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const token = localStorage.getItem('muxaro_auth_token') || sessionStorage.getItem('muxaro_auth_token');
    if (!token) return;

    await fetch('/api/v1/account/preferences', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ecoSettings: {
          enabled: settings.enabled,
          preferStreamCopy: settings.preferStreamCopy,
          energySaverBitrate: settings.energySaverBitrate,
        },
      }),
    }).catch(() => {
      // Ignore background sync errors gracefully
    });
  } catch {
    // Non-blocking network sync
  }
}

function initBatteryMonitoring(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

  const nav = navigator as any;
  if (typeof nav.getBattery === 'function') {
    nav.getBattery().then((battery: any) => {
      const updateBatteryState = () => {
        const isLow = battery.level < 0.2 && !battery.charging;
        if (currentSettings.isBatteryThrottling !== isLow) {
          currentSettings = {
            ...currentSettings,
            isBatteryThrottling: isLow,
            // If battery throttling engaged and autoThrottle is on, force eco mode on
            ...(isLow && currentSettings.autoThrottleBattery ? { enabled: true, preferStreamCopy: true } : {}),
          };
          saveToLocalStorage(currentSettings);
          notifyListeners();
        }
      };

      updateBatteryState();
      battery.addEventListener('levelchange', updateBatteryState);
      battery.addEventListener('chargingchange', updateBatteryState);
    }).catch(() => {
      // Battery API not permitted or available
    });
  }
}

export function initEcoStore(): EcoSettings {
  if (isInitialized) return currentSettings;
  isInitialized = true;

  if (typeof window !== 'undefined') {
    const local = loadFromLocalStorage();
    currentSettings = {
      ...DEFAULT_ECO_SETTINGS,
      ...local,
    };
    initBatteryMonitoring();
  }

  return currentSettings;
}

export function getEcoSettings(): EcoSettings {
  if (!isInitialized) {
    return initEcoStore();
  }
  return currentSettings;
}

export function setEcoSettings(partial: Partial<EcoSettings>): EcoSettings {
  const prev = getEcoSettings();
  const next: EcoSettings = {
    ...prev,
    ...partial,
  };

  currentSettings = next;
  saveToLocalStorage(next);
  notifyListeners();
  syncWithServerIfAuthenticated(next);
  return next;
}

export function toggleEcoMode(): boolean {
  const current = getEcoSettings();
  const nextState = !current.enabled;
  setEcoSettings({
    enabled: nextState,
    preferStreamCopy: nextState ? true : current.preferStreamCopy,
  });
  return nextState;
}

/**
 * Record a job that completed with Eco Mode / Stream Copy.
 * Stream copy saves an estimated ~24 grams of CO2 compared to 1080p software transcoding.
 */
export function recordEcoJobSaved(durationSec: number = 180): void {
  const current = getEcoSettings();
  // Roughly 0.13 grams CO2 per second of CPU transcoding saved
  const savedGrams = Math.round(durationSec * 0.13);
  setEcoSettings({
    jobsProcessedEco: current.jobsProcessedEco + 1,
    estimatedCarbonSavedGrams: current.estimatedCarbonSavedGrams + Math.max(5, savedGrams),
  });
}

export function subscribeEcoStore(listener: EcoListener): () => void {
  listeners.add(listener);
  // Initial callback
  listener(getEcoSettings());
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React Hook for consuming and modifying Eco Mode preferences.
 */
export function useEcoStore(): {
  settings: EcoSettings;
  updateSettings: (partial: Partial<EcoSettings>) => void;
  toggleEco: () => void;
  recordSavedJob: (durationSec?: number) => void;
} {
  const [settings, setLocalSettings] = useState<EcoSettings>(() => getEcoSettings());

  useEffect(() => {
    initEcoStore();
    return subscribeEcoStore((newSettings) => {
      setLocalSettings(newSettings);
    });
  }, []);

  const updateSettings = useCallback((partial: Partial<EcoSettings>) => {
    setEcoSettings(partial);
  }, []);

  const toggleEco = useCallback(() => {
    toggleEcoMode();
  }, []);

  const recordSavedJob = useCallback((durationSec?: number) => {
    recordEcoJobSaved(durationSec);
  }, []);

  return {
    settings,
    updateSettings,
    toggleEco,
    recordSavedJob,
  };
}

export default useEcoStore;

