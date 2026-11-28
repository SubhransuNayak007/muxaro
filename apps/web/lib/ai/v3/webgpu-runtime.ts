'use client';

import type { ChatToolCall, ChatToolDef, NormalizedChatMessage } from '../server/provider-adapters.ts';

export interface WebGpuAvailability {
  supported: boolean;
  reason?: string;
  adapterDescription?: string;
  deviceMemoryGb?: number;
  cachedModels: string[];
}

export interface WebGpuProgress {
  progressPct: number;
  text: string;
}

let cachedEngine: any = null;
let loadedModelId: string | null = null;
let loadPromise: Promise<any> | null = null;

export async function probeWebGpuAvailability(): Promise<WebGpuAvailability> {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'SSR environment', cachedModels: [] };
  }
  const nav = navigator as any;
  const cachedModels: string[] = [];
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      for (const k of keys) {
        if (/webllm|mlc/i.test(k)) cachedModels.push(k);
      }
    } catch {}
  }

  if (!nav.gpu || typeof nav.gpu.requestAdapter !== 'function') {
    return {
      supported: false,
      reason: 'WebGPU is not enabled in this browser (use Chromium 113+ on Desktop/Android, or Cloud BYOK).',
      deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
      cachedModels,
    };
  }

  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        reason: 'No compatible WebGPU hardware adapter found.',
        deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
        cachedModels,
      };
    }
    const info = adapter.info || {};
    const desc = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'WebGPU Adapter';
    return {
      supported: true,
      adapterDescription: desc,
      deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
      cachedModels,
    };
  } catch (err) {
    return {
      supported: false,
      reason: err instanceof Error ? err.message : 'WebGPU initialization failed.',
      cachedModels,
    };
  }
}

export async function ensureWebGpuEngine(
  modelId: string,
  onProgress?: (p: WebGpuProgress) => void
): Promise<any> {
  if (cachedEngine && loadedModelId === modelId) {
    return cachedEngine;
  }
  if (loadPromise && loadedModelId === modelId) {
    return loadPromise;
  }

  if (cachedEngine && loadedModelId !== modelId) {
    await unloadWebGpuEngine();
  }

  loadedModelId = modelId;
  loadPromise = (async () => {
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
    const engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (report: { progress?: number; text?: string }) => {
        onProgress?.({
          progressPct: Math.round((report.progress || 0) * 100),
          text: String(report.text || 'Loading WebGPU weights…'),
        });
      },
    });
    cachedEngine = engine;
    return engine;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadedModelId = null;
    loadPromise = null;
    throw err;
  }
}

export async function unloadWebGpuEngine(): Promise<void> {
  if (cachedEngine && typeof cachedEngine.unload === 'function') {
    await cachedEngine.unload().catch(() => {});
  }
  cachedEngine = null;
  loadedModelId = null;
  loadPromise = null;
}

export async function purgeWebGpuCache(): Promise<void> {
  await unloadWebGpuEngine();
  if (typeof window !== 'undefined' && 'caches' in window) {
    const keys = await caches.keys().catch(() => []);
    for (const k of keys) {
      if (/webllm|mlc/i.test(k)) {
        await caches.delete(k).catch(() => {});
      }
    }
  }
}

function buildCompactToolPrompt(tools: ChatToolDef[]): string {
  if (!tools.length) return '';
  const desc = tools
    .map((t) => `- ${t.name}: ${t.description} | args=${JSON.stringify(t.parameters)}`)
    .join('\n');
  return [
    '\nLOCAL TOOL CALLING PROTOCOL:',
    'When a tool is needed, reply ONLY with a single line block:',
    '<tool_call>{"name":"tool_name","arguments":{...}}</tool_call>',
    'Otherwise answer the user cleanly in Markdown.',
    'AVAILABLE TOOLS:',
    desc,
  ].join('\n');
}

function extractInlineToolCall(text: string): { cleanText: string; toolCalls?: ChatToolCall[] } {
  const m = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
  if (!m) return { cleanText: text };
  try {
    const parsed = JSON.parse(m[1]) as { name?: string; arguments?: Record<string, unknown> };
    if (parsed.name) {
      return {
        cleanText: text.replace(m[0], '').trim(),
        toolCalls: [
          {
            id: `call_wgpu_${Date.now()}`,
            name: String(parsed.name),
            arguments: parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments : {},
          },
        ],
      };
    }
  } catch {}
  return { cleanText: text };
}

export async function runWebGpuChatTurn(params: {
  modelId: string;
  systemPrompt: string;
  messages: NormalizedChatMessage[];
  tools: ChatToolDef[];
  onToken?: (partial: string) => void;
  onLoadProgress?: (p: WebGpuProgress) => void;
}): Promise<{
  text: string;
  toolCalls?: ChatToolCall[];
  engineLabel: string;
}> {
  const engine = await ensureWebGpuEngine(params.modelId, params.onLoadProgress);
  const fullSystem = `${params.systemPrompt}${buildCompactToolPrompt(params.tools)}`;

  const formattedMessages = [
    { role: 'system', content: fullSystem },
    ...params.messages.map((m) => ({
      role: m.role === 'tool' ? 'user' : m.role,
      content:
        m.role === 'tool'
          ? `[TOOL RESULT (${m.toolName || 'tool'})]: ${m.content}`
          : m.toolCalls?.length
            ? `<tool_call>${JSON.stringify({ name: m.toolCalls[0].name, arguments: m.toolCalls[0].arguments })}</tool_call>`
            : m.content,
    })),
  ];

  const chunks = await engine.chat.completions.create({
    messages: formattedMessages,
    temperature: 0.25,
    max_tokens: 1400,
    stream: true,
  });

  let acc = '';
  for await (const chunk of chunks) {
    const delta = chunk?.choices?.[0]?.delta?.content || '';
    if (delta) {
      acc += delta;
      if (!acc.includes('<tool_call>')) {
        params.onToken?.(acc);
      }
    }
  }

  const parsed = extractInlineToolCall(acc);
  return {
    text: parsed.cleanText,
    toolCalls: parsed.toolCalls,
    engineLabel: `WebGPU (${params.modelId.split('-Instruct')[0]})`,
  };
}
