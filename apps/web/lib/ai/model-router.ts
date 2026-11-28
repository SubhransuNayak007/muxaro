import { getRuntimePlatform, isDesktopApp, isCapacitorApp } from '@/lib/native-bridge';
import { maskPromptWithPiiMap, unmaskResponseWithPiiMap } from './pii-detector';
import { buildGroundedSystemAndUserPrompt } from './prompt-guard';
import { buildTier0ExtractiveAnswer, queryRagSpace, queryRagSpaceHybrid } from './local-rag';
import {
  loadAiV3Settings,
  loadClientByokKey,
  resolveAiHttpOrigin,
} from './v3/settings-store';
import { probeWebGpuAvailability, runWebGpuChatTurn } from './v3/webgpu-runtime';
import type { ChatToolCall, ChatToolDef, NormalizedChatMessage } from './server/provider-adapters';
import type { ReActTurnResponse } from './v3/agent-loop';
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
  const byokLocal = await loadClientByokKey().catch(() => null);
  const webgpu = await probeWebGpuAvailability().catch(() => ({ supported: false, cachedModels: [] }));

  const base: AiRuntimeStatus & { webgpuSupported?: boolean; webgpuAdapter?: string } = {
    mode: preferredMode,
    platform,
    ollamaAvailable: false,
    ollamaModels: [],
    llamaServerAvailable: false,
    lmStudioAvailable: false,
    lanMeshEnabled: false,
    lanMeshUrl: getSavedLanMeshUrl() || undefined,
    byokConfigured: Boolean(byokLocal?.apiKey),
    byokProvider: (byokLocal?.provider === 'groq' ? 'openai' : byokLocal?.provider) as AiRuntimeStatus['byokProvider'],
    androidNativeTts: false,
    androidLocalSlmReady: false,
    webgpuSupported: webgpu.supported,
    webgpuAdapter: 'adapterDescription' in webgpu ? webgpu.adapterDescription : undefined,
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
            byokConfigured: Boolean(json.data.byokConfigured || byokLocal?.apiKey),
            mode: preferredMode,
            platform,
          };
        }
      }
    } catch {}
  }

  if (isCapacitorApp()) {
    try {
      const plugin = window.Capacitor?.Plugins?.MuxaroAi;
      if (plugin?.getCapabilities) {
        const caps = await plugin.getCapabilities();
        base.androidNativeTts = Boolean(caps?.ttsReady);
        base.androidLocalSlmReady = Boolean(caps?.slmReady);
        base.byokConfigured = Boolean(caps?.byokConfigured || byokLocal?.apiKey);
        base.byokProvider = caps?.byokProvider || base.byokProvider;
        base.totalRamMb = caps?.totalRamMb;
      }
    } catch {}
  }

  return base;
}

async function consumeUnifiedSseStream(
  resp: Response,
  maskMap: Record<string, string>,
  onToken?: (partial: string) => void
): Promise<ReActTurnResponse> {
  if (!resp.body) throw new Error('Missing stream body.');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let acc = '';
  const toolCalls: ChatToolCall[] = [];
  let reasoning = '';
  let engineLabel: string | undefined;
  let usage: ReActTurnResponse['usage'];

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
        if (evt.error) {
          throw new Error(String(evt.error));
        }
        if (typeof evt.reasoning === 'string') reasoning += evt.reasoning;
        if (typeof evt.token === 'string') {
          acc += evt.token;
          const shown = Object.keys(maskMap).length > 0 ? unmaskResponseWithPiiMap(acc, maskMap) : acc;
          onToken?.(shown);
        }
        if (Array.isArray(evt.toolCalls)) {
          toolCalls.push(...evt.toolCalls);
        }
        if (evt.usage) usage = evt.usage;
        if (evt.done) {
          if (typeof evt.answer === 'string' && !acc) acc = evt.answer;
          if (typeof evt.engineLabel === 'string') engineLabel = evt.engineLabel;
        }
      } catch (e) {
        if (e instanceof Error && !e.message.includes('JSON')) throw e;
      }
    }
  }

  const finalText = Object.keys(maskMap).length > 0 ? unmaskResponseWithPiiMap(acc, maskMap) : acc;
  return {
    text: finalText,
    reasoning: reasoning || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    engineLabel,
    usage,
  };
}

/**
 * Unified single ReAct model turn across:
 * 1) Desktop EXE local server (`Ollama / LM Studio / safeStorage BYOK`)
 * 2) LAN Mesh host URL
 * 3) Website / Worker `/api/v1/ai/chat` SSE (User BYOK OR optional Server Trial)
 * 4) Browser WebGPU local SLM (`@mlc-ai/web-llm`)
 */
export async function executeUnifiedModelTurn(params: {
  mode: AiEngineMode;
  modelName?: string;
  systemPrompt: string;
  messages: NormalizedChatMessage[];
  tools: ChatToolDef[];
  maskPii?: boolean;
  onToken?: (partial: string) => void;
  onWebGpuProgress?: (pct: number, text: string) => void;
  signal?: AbortSignal;
}): Promise<ReActTurnResponse> {
  const settings = loadAiV3Settings();
  const byok = await loadClientByokKey().catch(() => null);
  let maskMap: Record<string, string> = {};
  let preparedMessages = params.messages;

  if (params.maskPii) {
    preparedMessages = params.messages.map((m) => {
      if (m.role !== 'user' || !m.content) return m;
      const masked = maskPromptWithPiiMap(m.content);
      maskMap = { ...maskMap, ...masked.tokenMap };
      return { ...m, content: masked.sanitizedText };
    });
  }

  // 1. Desktop EXE or explicit LAN Mesh
  const localBase =
    params.mode === 'lan-mesh' && getSavedLanMeshUrl()
      ? getSavedLanMeshUrl()
      : isDesktopApp() && window.muxaroDesktop?.localPort
        ? `http://127.0.0.1:${window.muxaroDesktop.localPort}`
        : '';

  if (localBase && (params.mode !== 'byok-cloud' || isDesktopApp())) {
    const lastUser = [...preparedMessages].reverse().find((m) => m.role === 'user')?.content || '';
    const resp = await fetch(`${localBase}/api/v1/ai/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: params.signal,
      body: JSON.stringify({
        mode: params.mode,
        model: params.modelName || settings.model,
        systemPrompt: params.systemPrompt,
        userPrompt: lastUser,
        messages: preparedMessages,
        tools: params.tools,
      }),
    });
    if (resp.ok) {
      return await consumeUnifiedSseStream(resp, maskMap, params.onToken);
    }
  }

  // 2. Cloud BYOK OR Trial Proxy (`/api/v1/ai/chat`)
  if (params.mode === 'byok-cloud' || Boolean(byok?.apiKey) || settings.runtimePreference === 'auto') {
    const shouldTryProxy =
      params.mode === 'byok-cloud' ||
      Boolean(byok?.apiKey) ||
      (settings.allowPublicTrialFallback && settings.runtimePreference !== 'webgpu-local');

    if (shouldTryProxy) {
      const origin = resolveAiHttpOrigin();
      const resp = await fetch(`${origin}/api/v1/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(byok?.apiKey ? { 'x-muxaro-byok': byok.apiKey } : {}),
        },
        signal: params.signal,
        body: JSON.stringify({
          provider: byok?.provider || settings.provider,
          model: params.modelName || settings.model,
          systemPrompt: params.systemPrompt,
          messages: preparedMessages,
          tools: params.tools,
          maxTokens: settings.reasoningEffort === 'deep' ? 4096 : 2400,
        }),
      });
      if (resp.ok) {
        return await consumeUnifiedSseStream(resp, maskMap, params.onToken);
      }
      if (params.mode === 'byok-cloud' && !settings.runtimePreference.includes('webgpu')) {
        const errJson = await resp.json().catch(() => null);
        if (errJson?.message && settings.runtimePreference === 'byok-cloud') {
          throw new Error(String(errJson.message));
        }
      }
    }
  }

  // 3. Browser WebGPU Local SLM (`@mlc-ai/web-llm`)
  if (settings.runtimePreference === 'webgpu-local' || params.mode === 'local-slm') {
    const gpuAvail = await probeWebGpuAvailability();
    if (gpuAvail.supported) {
      return await runWebGpuChatTurn({
        modelId: settings.webgpuModelId,
        systemPrompt: params.systemPrompt,
        messages: preparedMessages,
        tools: params.tools,
        onToken: params.onToken,
        onLoadProgress: (p) => params.onWebGpuProgress?.(p.progressPct, p.text),
      });
    }
  }

  throw new Error(
    'No LLM engine active right now. Add an API key in Settings -> AI & Memory, turn on WebGPU Local SLM, or connect Ollama on Desktop.'
  );
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
  const masked = mode === 'byok-cloud' ? maskPromptWithPiiMap(userPrompt) : { sanitizedText: userPrompt, tokenMap: {} };

  try {
    const res = await executeUnifiedModelTurn({
      mode,
      modelName,
      systemPrompt,
      messages: [{ role: 'user', content: masked.sanitizedText }],
      tools: [],
      maskPii: false,
    });
    if (res.text.trim()) {
      const restored =
        mode === 'byok-cloud' ? unmaskResponseWithPiiMap(res.text, masked.tokenMap) : res.text;
      return {
        answer: restored,
        citations,
        usedEngineLabel: res.engineLabel || (mode === 'byok-cloud' ? 'BYOK Cloud (PII-Masked)' : 'Local SLM'),
        piiMaskedCount: Object.keys(masked.tokenMap).length,
      };
    }
  } catch {}

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
  try {
    const res = await executeUnifiedModelTurn({
      mode: params.mode,
      modelName: params.modelName,
      systemPrompt: params.systemPrompt,
      messages: [
        ...(params.history || []).slice(-8),
        { role: 'user', content: params.userPrompt },
      ],
      tools: [],
      maskPii: params.mode === 'byok-cloud',
      onToken: params.onToken,
    });
    return {
      ok: Boolean(res.text.trim()),
      answer: res.text,
      engineLabel: res.engineLabel,
    };
  } catch {
    return { ok: false, answer: '' };
  }
}
