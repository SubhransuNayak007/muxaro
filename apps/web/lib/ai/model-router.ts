import { getRuntimePlatform, isDesktopApp, isCapacitorApp } from '@/lib/native-bridge';
import { maskPromptWithPiiMap, unmaskResponseWithPiiMap } from './pii-detector';
import { buildGroundedSystemAndUserPrompt } from './prompt-guard';
import { buildTier0ExtractiveAnswer, queryRagSpace, queryRagSpaceHybrid } from './local-rag';
import type { AiEngineMode, AiRuntimeStatus, CitationRef, RagSpaceIndex } from './types';

const LAN_MESH_STORAGE_KEY = 'muxaro_lan_mesh_url_v1';
const PREFERRED_MODE_KEY = 'muxaro_ai_mode_v1';

export function getSavedLanMeshUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(LAN_MESH_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setSavedLanMeshUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) localStorage.setItem(LAN_MESH_STORAGE_KEY, clean);
    else localStorage.removeItem(LAN_MESH_STORAGE_KEY);
  } catch {}
}

export function getSavedAiMode(): AiEngineMode {
  if (typeof window === 'undefined') return 'tier0-offline';
  try {
    const v = localStorage.getItem(PREFERRED_MODE_KEY) as AiEngineMode | null;
    return v || 'tier0-offline';
  } catch {
    return 'tier0-offline';
  }
}

export function setSavedAiMode(mode: AiEngineMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFERRED_MODE_KEY, mode);
  } catch {}
}

export async function detectAiRuntimeStatus(): Promise<AiRuntimeStatus> {
  const platform = getRuntimePlatform();
  const preferredMode = getSavedAiMode();
  const base: AiRuntimeStatus = {
    mode: preferredMode,
    platform,
    ollamaAvailable: false,
    ollamaModels: [],
    llamaServerAvailable: false,
    lmStudioAvailable: false,
    lanMeshEnabled: false,
    lanMeshUrl: getSavedLanMeshUrl() || undefined,
    byokConfigured: false,
    androidNativeTts: false,
    androidLocalSlmReady: false,
  };

  if (isDesktopApp() && window.muxaroDesktop?.localPort) {
    try {
      const res = await fetch(`http://127.0.0.1:${window.muxaroDesktop.localPort}/api/v1/ai/runtime`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.ok && json.data) {
          return {
            ...base,
            ...json.data,
            mode: preferredMode,
            platform,
          };
        }
      }
    } catch {
      // Fall back cleanly to Tier-0
    }
  }

  if (isCapacitorApp()) {
    try {
      const plugin = window.Capacitor?.Plugins?.MuxaroAi;
      if (plugin?.getCapabilities) {
        const caps = await plugin.getCapabilities();
        base.androidNativeTts = Boolean(caps?.ttsReady);
        base.androidLocalSlmReady = Boolean(caps?.slmReady);
        base.byokConfigured = Boolean(caps?.byokConfigured);
        base.byokProvider = caps?.byokProvider;
        base.totalRamMb = caps?.totalRamMb;
      }
    } catch {
      // Fallback
    }
  }

  return base;
}

export async function runGroundedRagAnswer(params: {
  index: RagSpaceIndex;
  question: string;
  mode: AiEngineMode;
  modelName?: string;
}): Promise<{
  answer: string;
  citations: CitationRef[];
  usedEngineLabel: string;
  piiMaskedCount: number;
}> {
  const { index, question, mode, modelName } = params;
  const citations = await queryRagSpaceHybrid(index, question, 6).catch(() => queryRagSpace(index, question, 6));

  if (mode === 'tier0-offline' || !citations.length) {
    const out = buildTier0ExtractiveAnswer(index, question, citations);
    return {
      ...out,
      usedEngineLabel: 'Tier-0 Offline Engine (0ms)',
      piiMaskedCount: 0,
    };
  }

  const { systemPrompt, userPrompt } = buildGroundedSystemAndUserPrompt(question, citations);

  // Privacy Shield: Always mask PII entities before outbound BYOK Cloud calls
  let finalUserPrompt = userPrompt;
  let tokenMap: Record<string, string> = {};
  if (mode === 'byok-cloud') {
    const masked = maskPromptWithPiiMap(userPrompt);
    finalUserPrompt = masked.sanitizedText;
    tokenMap = masked.tokenMap;
  }

  const targetBase =
    mode === 'lan-mesh' && getSavedLanMeshUrl()
      ? getSavedLanMeshUrl()
      : isDesktopApp() && window.muxaroDesktop?.localPort
        ? `http://127.0.0.1:${window.muxaroDesktop.localPort}`
        : '';

  if (targetBase) {
    try {
      const resp = await fetch(`${targetBase}/api/v1/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          model: modelName,
          systemPrompt,
          userPrompt: finalUserPrompt,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.ok && typeof data.answer === 'string' && data.answer.trim()) {
          const restored =
            mode === 'byok-cloud' ? unmaskResponseWithPiiMap(data.answer, tokenMap) : data.answer;
          return {
            answer: restored,
            citations,
            usedEngineLabel: data.engineLabel || (mode === 'byok-cloud' ? 'BYOK Cloud (PII-Masked)' : 'Local SLM'),
            piiMaskedCount: Object.keys(tokenMap).length,
          };
        }
      }
    } catch {
      // Automatic resilient fallback to Tier-0
    }
  }

  const fallback = buildTier0ExtractiveAnswer(index, question, citations);
  return {
    ...fallback,
    usedEngineLabel: 'Tier-0 Offline Fallback',
    piiMaskedCount: 0,
  };
}

export async function streamAiConversation(params: {
  mode: AiEngineMode;
  modelName?: string;
  systemPrompt: string;
  userPrompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onToken: (partialFullText: string) => void;
}): Promise<{ ok: boolean; answer: string; engineLabel?: string; tokensPerSec?: number }> {
  const { mode, modelName, systemPrompt, userPrompt, history = [], onToken } = params;
  let finalUser = userPrompt;
  let tokenMap: Record<string, string> = {};
  if (mode === 'byok-cloud') {
    const masked = maskPromptWithPiiMap(userPrompt);
    finalUser = masked.sanitizedText;
    tokenMap = masked.tokenMap;
  }

  const targetBase =
    mode === 'lan-mesh' && getSavedLanMeshUrl()
      ? getSavedLanMeshUrl()
      : isDesktopApp() && window.muxaroDesktop?.localPort
        ? `http://127.0.0.1:${window.muxaroDesktop.localPort}`
        : '';
  if (!targetBase) return { ok: false, answer: '' };

  try {
    const resp = await fetch(`${targetBase}/api/v1/ai/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        model: modelName,
        systemPrompt,
        userPrompt: finalUser,
        messages: history.slice(-8),
      }),
    });
    if (!resp.ok || !resp.body) return { ok: false, answer: '' };

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let acc = '';
    let engineLabel: string | undefined;
    let tokensPerSec: number | undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop() || '';
      for (const blk of blocks) {
        const line = blk.trim();
        if (!line.startsWith('data:')) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.token) {
            acc += String(evt.token);
            const shown = mode === 'byok-cloud' ? unmaskResponseWithPiiMap(acc, tokenMap) : acc;
            onToken(shown);
          }
          if (evt.done) {
            if (evt.answer && !acc) acc = String(evt.answer);
            engineLabel = evt.engineLabel;
            tokensPerSec = evt.tokensPerSec;
          }
        } catch {}
      }
    }

    const restored = mode === 'byok-cloud' ? unmaskResponseWithPiiMap(acc, tokenMap) : acc;
    return { ok: Boolean(restored.trim()), answer: restored, engineLabel, tokensPerSec };
  } catch {
    return { ok: false, answer: '' };
  }
}
