'use client';

import { getRuntimePlatform, isCapacitorApp, isDesktopApp } from '@/lib/native-bridge';
import type { AiProviderId } from '../server/provider-adapters.ts';

export type { AiProviderId };

export type AiRuntimePreference =
  | 'auto'
  | 'webgpu-local'
  | 'desktop-ollama'
  | 'byok-cloud'
  | 'tier0-offline';

export type KeyPersistenceMode = 'session' | 'device-encrypted';

export interface MuxaroAiV3Settings {
  runtimePreference: AiRuntimePreference;
  provider: AiProviderId;
  model: string;
  keyPersistence: KeyPersistenceMode;
  webgpuModelId: string;
  reasoningEffort: 'quick' | 'deep';
  autonomyMaxTurns: number;
  allowPublicTrialFallback: boolean;
  dreamingEnabled: boolean;
  skillsAutoLearn: boolean;
  mcpServers: Array<{
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    pinnedToolHashes?: Record<string, string>;
  }>;
}

const SETTINGS_SLOT = 'muxaro_ai_v3_settings_v1';
const SESSION_BYOK_SLOT = 'muxaro_ai_v3_session_byok';
const ENCRYPTED_BYOK_SLOT = 'muxaro_ai_v3_enc_byok';
const DEVICE_SALT_SLOT = 'muxaro_ai_v3_device_salt';

export const DEFAULT_AI_V3_SETTINGS: MuxaroAiV3Settings = {
  runtimePreference: 'auto',
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  keyPersistence: 'session',
  webgpuModelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  reasoningEffort: 'quick',
  autonomyMaxTurns: 8,
  allowPublicTrialFallback: true,
  dreamingEnabled: true,
  skillsAutoLearn: true,
  mcpServers: [],
};

export const PROVIDER_DEFAULT_MODELS: Record<AiProviderId, string[]> = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  openai: ['gpt-4o-mini', 'gpt-4.1', 'o3-mini'],
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-7-sonnet-latest'],
  openrouter: ['google/gemini-2.5-flash', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-r1'],
  groq: ['llama-3.3-70b-versatile', 'qwen-qwq-32b'],
};

export const WEBGPU_RECOMMENDED_MODELS = [
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 1.5B (Fast · ~950 MB)',
    minRamGb: 4,
    notes: 'Best speed for formatting, ReAct routing, and doc Q&A on laptops.',
  },
  {
    id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
    label: 'SmolLM2 1.7B (Compact · ~1.0 GB)',
    minRamGb: 4,
    notes: 'Strong general assistant on mid-range GPUs.',
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 3B (Balanced · ~1.9 GB)',
    minRamGb: 8,
    notes: 'Higher reasoning and multi-tool planning quality for desktop WebGPU.',
  },
] as const;

export function loadAiV3Settings(): MuxaroAiV3Settings {
  if (typeof window === 'undefined') return { ...DEFAULT_AI_V3_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_SLOT);
    if (!raw) return { ...DEFAULT_AI_V3_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<MuxaroAiV3Settings>;
    return {
      ...DEFAULT_AI_V3_SETTINGS,
      ...parsed,
      mcpServers: Array.isArray(parsed.mcpServers) ? parsed.mcpServers : [],
    };
  } catch {
    return { ...DEFAULT_AI_V3_SETTINGS };
  }
}

export function saveAiV3Settings(next: MuxaroAiV3Settings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_SLOT, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('muxaro:ai-settings-changed', { detail: next }));
  } catch {}
}

function getOrCreateDeviceMaterial(): string {
  let salt = localStorage.getItem(DEVICE_SALT_SLOT);
  if (!salt) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    salt = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_SALT_SLOT, salt);
  }
  return `${salt}|${navigator.userAgent.slice(0, 40)}|muxaro-v3`;
}

async function deriveWebAesKey(): Promise<CryptoKey> {
  const material = new TextEncoder().encode(getOrCreateDeviceMaterial());
  const baseKey = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
  const fixedSalt = new TextEncoder().encode('muxaro-byok-aes-gcm-v3');
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fixedSalt, iterations: 25000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function saveClientByokKey(
  provider: AiProviderId,
  apiKey: string,
  persistence: KeyPersistenceMode
): Promise<void> {
  if (typeof window === 'undefined') return;
  const clean = apiKey.trim();

  if (isDesktopApp() && window.muxaroDesktop?.localPort) {
    await fetch(`http://127.0.0.1:${window.muxaroDesktop.localPort}/api/v1/ai/byok`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey: clean }),
    }).catch(() => {});
  } else if (isCapacitorApp()) {
    await window.Capacitor?.Plugins?.MuxaroAi?.saveByokKey?.({
      provider,
      apiKey: clean,
    }).catch(() => {});
  }

  if (!clean) {
    try {
      sessionStorage.removeItem(SESSION_BYOK_SLOT);
      localStorage.removeItem(ENCRYPTED_BYOK_SLOT);
    } catch {}
    return;
  }

  // Always keep inside sessionStorage for immediate tab use
  try {
    sessionStorage.setItem(SESSION_BYOK_SLOT, JSON.stringify({ provider, apiKey: clean }));
  } catch {}

  if (persistence === 'device-encrypted' && window.crypto?.subtle) {
    try {
      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv);
      const key = await deriveWebAesKey();
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(JSON.stringify({ provider, apiKey: clean }))
      );
      const pack = {
        v: 1,
        iv: Array.from(iv),
        ct: Array.from(new Uint8Array(ct)),
      };
      localStorage.setItem(ENCRYPTED_BYOK_SLOT, JSON.stringify(pack));
    } catch {}
  } else {
    try {
      localStorage.removeItem(ENCRYPTED_BYOK_SLOT);
    } catch {}
  }
}

export async function loadClientByokKey(): Promise<{ provider: AiProviderId; apiKey: string } | null> {
  if (typeof window === 'undefined') return null;
  try {
    const sess = sessionStorage.getItem(SESSION_BYOK_SLOT);
    if (sess) {
      const p = JSON.parse(sess) as { provider?: AiProviderId; apiKey?: string };
      if (p.apiKey && p.provider) return { provider: p.provider, apiKey: p.apiKey };
    }
  } catch {}

  try {
    const raw = localStorage.getItem(ENCRYPTED_BYOK_SLOT);
    if (raw && window.crypto?.subtle) {
      const pack = JSON.parse(raw) as { iv?: number[]; ct?: number[] };
      if (Array.isArray(pack.iv) && Array.isArray(pack.ct)) {
        const key = await deriveWebAesKey();
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(pack.iv) },
          key,
          new Uint8Array(pack.ct)
        );
        const parsed = JSON.parse(new TextDecoder().decode(plain)) as {
          provider?: AiProviderId;
          apiKey?: string;
        };
        if (parsed.apiKey && parsed.provider) {
          return { provider: parsed.provider, apiKey: parsed.apiKey };
        }
      }
    }
  } catch {}
  return null;
}

export function hasClientByokKeySync(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(
      sessionStorage.getItem(SESSION_BYOK_SLOT) || localStorage.getItem(ENCRYPTED_BYOK_SLOT)
    );
  } catch {
    return false;
  }
}

export function resolveAiHttpOrigin(): string {
  const platform = getRuntimePlatform();
  if (platform === 'desktop-exe' && typeof window !== 'undefined' && window.muxaroDesktop?.localPort) {
    return `http://127.0.0.1:${window.muxaroDesktop.localPort}`;
  }
  if (platform === 'android-apk') {
    try {
      const custom = (localStorage.getItem('muxaro_custom_worker_url') || '').trim().replace(/\/+$/, '');
      if (custom) return custom;
    } catch {}
    const pubSite = (process.env.NEXT_PUBLIC_SITE_URL || 'https://muxaro.vercel.app').trim().replace(/\/+$/, '');
    return pubSite;
  }
  // Browser Web App SSR origin handles /api/v1/ai/* directly
  return '';
}
