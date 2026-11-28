import { z } from 'zod';

export const AiProviderIdSchema = z.enum([
  'gemini',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
]);

export type AiProviderId = z.infer<typeof AiProviderIdSchema>;

export const ChatToolDefSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(1200),
  parameters: z.record(z.string(), z.unknown()),
});

export type ChatToolDef = z.infer<typeof ChatToolDefSchema>;

export const ChatToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().max(160_000),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  toolCalls: z.array(ChatToolCallSchema).optional(),
});

export type NormalizedChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatCompletionRequestSchema = z.object({
  provider: AiProviderIdSchema.default('gemini'),
  model: z.string().max(120).optional(),
  systemPrompt: z.string().max(40_000).optional(),
  messages: z.array(ChatMessageSchema).min(1).max(80),
  tools: z.array(ChatToolDefSchema).max(32).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(64).max(16384).optional(),
  jsonMode: z.boolean().optional(),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

export interface NormalizedSseChunk {
  token?: string;
  reasoning?: string;
  toolCalls?: ChatToolCall[];
  done?: boolean;
  engineLabel?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: string;
}

const DEFAULT_MODELS: Record<AiProviderId, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  openrouter: 'google/gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
};

const TRIAL_BUCKET = new Map<string, { count: number; resetAt: number }>();

export function checkTrialRateLimit(clientKey: string, maxPerHour = 10): {
  allowed: boolean;
  remaining: number;
  resetAfterSec: number;
} {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const cur = TRIAL_BUCKET.get(clientKey);
  if (!cur || now >= cur.resetAt) {
    TRIAL_BUCKET.set(clientKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxPerHour - 1, resetAfterSec: 3600 };
  }
  if (cur.count >= maxPerHour) {
    return {
      allowed: false,
      remaining: 0,
      resetAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)),
    };
  }
  cur.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, maxPerHour - cur.count),
    resetAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)),
  };
}

export function sanitizeUpstreamError(rawMessage: string, sensitiveKey?: string): string {
  let clean = String(rawMessage || 'Upstream AI provider request failed.');
  if (sensitiveKey && sensitiveKey.length > 6) {
    clean = clean.split(sensitiveKey).join('[REDACTED_KEY]');
  }
  clean = clean
    .replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_KEY]')
    .replace(/\bAIza[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
    .replace(/\bgsk_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]');
  return clean.slice(0, 420);
}

export function parseOpenAiSseDataLine(jsonLine: string): {
  token?: string;
  reasoning?: string;
  toolCallDeltas?: Array<{ index: number; id?: string; name?: string; argumentsChunk?: string }>;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
} {
  const parsed = JSON.parse(jsonLine) as Record<string, any>;
  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
  const delta = choice?.delta || {};
  const token = typeof delta.content === 'string' ? delta.content : undefined;
  const reasoning =
    typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta.reasoning === 'string'
        ? delta.reasoning
        : undefined;

  const toolCallDeltas: Array<{ index: number; id?: string; name?: string; argumentsChunk?: string }> = [];
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      toolCallDeltas.push({
        index: Number(tc.index || 0),
        id: typeof tc.id === 'string' ? tc.id : undefined,
        name: typeof tc.function?.name === 'string' ? tc.function.name : undefined,
        argumentsChunk: typeof tc.function?.arguments === 'string' ? tc.function.arguments : undefined,
      });
    }
  }

  const usage = parsed.usage
    ? {
        inputTokens: typeof parsed.usage.prompt_tokens === 'number' ? parsed.usage.prompt_tokens : undefined,
        outputTokens: typeof parsed.usage.completion_tokens === 'number' ? parsed.usage.completion_tokens : undefined,
      }
    : undefined;

  return {
    token,
    reasoning,
    toolCallDeltas: toolCallDeltas.length ? toolCallDeltas : undefined,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
    usage,
  };
}

export function parseGeminiSseDataLine(jsonLine: string): {
  token?: string;
  toolCalls?: ChatToolCall[];
  usage?: { inputTokens?: number; outputTokens?: number };
} {
  const parsed = JSON.parse(jsonLine) as Record<string, any>;
  const parts: Array<Record<string, any>> = parsed?.candidates?.[0]?.content?.parts || [];
  let token = '';
  const toolCalls: ChatToolCall[] = [];
  for (const part of parts) {
    if (typeof part.text === 'string') token += part.text;
    if (part.functionCall && typeof part.functionCall.name === 'string') {
      toolCalls.push({
        id: `call_gem_${Math.random().toString(36).slice(2, 10)}`,
        name: part.functionCall.name,
        arguments:
          part.functionCall.args && typeof part.functionCall.args === 'object'
            ? (part.functionCall.args as Record<string, unknown>)
            : {},
      });
    }
  }
  const usageMeta = parsed.usageMetadata;
  const usage = usageMeta
    ? {
        inputTokens: typeof usageMeta.promptTokenCount === 'number' ? usageMeta.promptTokenCount : undefined,
        outputTokens:
          typeof usageMeta.candidatesTokenCount === 'number' ? usageMeta.candidatesTokenCount : undefined,
      }
    : undefined;

  return {
    token: token || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    usage,
  };
}

function buildOpenAiPayload(req: ChatCompletionRequest, model: string, stream = true) {
  const msgs: Array<Record<string, unknown>> = [];
  if (req.systemPrompt?.trim()) {
    msgs.push({ role: 'system', content: req.systemPrompt.trim() });
  }
  for (const m of req.messages) {
    if (m.role === 'tool') {
      msgs.push({
        role: 'tool',
        tool_call_id: m.toolCallId || `call_${m.toolName || 'tool'}`,
        content: m.content,
      });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      msgs.push({
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments || {}),
          },
        })),
      });
    } else {
      msgs.push({ role: m.role, content: m.content });
    }
  }

  return {
    model,
    stream,
    messages: msgs,
    temperature: req.temperature ?? 0.3,
    max_tokens: req.maxTokens ?? 2400,
    ...(req.jsonMode && !req.tools?.length ? { response_format: { type: 'json_object' } } : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
          tool_choice: 'auto',
        }
      : {}),
  };
}

function buildGeminiPayload(req: ChatCompletionRequest) {
  const contents: Array<Record<string, unknown>> = [];
  for (const m of req.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.toolName || 'tool_result',
              response: { result: m.content },
            },
          },
        ],
      });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const parts: Array<Record<string, unknown>> = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls) {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments || {} } });
      }
      contents.push({ role: 'model', parts });
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }
  }

  return {
    ...(req.systemPrompt?.trim()
      ? { systemInstruction: { parts: [{ text: req.systemPrompt.trim() }] } }
      : {}),
    contents,
    generationConfig: {
      temperature: req.temperature ?? 0.3,
      maxOutputTokens: req.maxTokens ?? 2400,
      ...(req.jsonMode && !req.tools?.length ? { responseMimeType: 'application/json' } : {}),
    },
    ...(req.tools?.length
      ? {
          tools: [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            },
          ],
        }
      : {}),
  };
}

function buildAnthropicPayload(req: ChatCompletionRequest, model: string, stream = true) {
  const messages: Array<Record<string, unknown>> = [];
  for (const m of req.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId || `call_${m.toolName || 'tool'}`,
            content: m.content,
          },
        ],
      });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments || {},
        });
      }
      messages.push({ role: 'assistant', content: blocks });
    } else {
      messages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      });
    }
  }

  return {
    model,
    stream,
    max_tokens: req.maxTokens ?? 2400,
    temperature: req.temperature ?? 0.3,
    ...(req.systemPrompt?.trim() ? { system: req.systemPrompt.trim() } : {}),
    messages,
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }
      : {}),
  };
}

export async function streamProviderChat(params: {
  request: ChatCompletionRequest;
  apiKey: string;
  onChunk: (chunk: NormalizedSseChunk) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { request: req, apiKey, onChunk, signal } = params;
  const provider = req.provider;
  const model = (req.model || '').trim() || DEFAULT_MODELS[provider];

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeminiPayload(req)),
      signal,
    });
    if (!resp.ok || !resp.body) {
      const errTxt = await resp.text().catch(() => '');
      throw new Error(sanitizeUpstreamError(errTxt || `Gemini HTTP ${resp.status}`, apiKey));
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const collectedTools: ChatToolCall[] = [];
    let usage: NormalizedSseChunk['usage'];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const rawJson = line.slice(5).trim();
        if (!rawJson || rawJson === '[DONE]') continue;
        try {
          const parsed = parseGeminiSseDataLine(rawJson);
          if (parsed.token) onChunk({ token: parsed.token });
          if (parsed.toolCalls) collectedTools.push(...parsed.toolCalls);
          if (parsed.usage) usage = parsed.usage;
        } catch {}
      }
    }
    onChunk({
      done: true,
      engineLabel: `Gemini (${model})`,
      ...(collectedTools.length ? { toolCalls: collectedTools } : {}),
      ...(usage ? { usage } : {}),
    });
    return;
  }

  if (provider === 'anthropic') {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(buildAnthropicPayload(req, model, true)),
      signal,
    });
    if (!resp.ok || !resp.body) {
      const errTxt = await resp.text().catch(() => '');
      throw new Error(sanitizeUpstreamError(errTxt || `Anthropic HTTP ${resp.status}`, apiKey));
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const pendingTools = new Map<number, { id: string; name: string; rawJson: string }>();
    let usage: NormalizedSseChunk['usage'];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const rawJson = line.slice(5).trim();
        if (!rawJson) continue;
        try {
          const evt = JSON.parse(rawJson) as Record<string, any>;
          if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
            pendingTools.set(Number(evt.index || 0), {
              id: String(evt.content_block.id || `call_ant_${Date.now()}`),
              name: String(evt.content_block.name || ''),
              rawJson: '',
            });
          } else if (evt.type === 'content_block_delta') {
            if (evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
              onChunk({ token: evt.delta.text });
            } else if (evt.delta?.type === 'thinking_delta' && typeof evt.delta.thinking === 'string') {
              onChunk({ reasoning: evt.delta.thinking });
            } else if (evt.delta?.type === 'input_json_delta' && typeof evt.delta.partial_json === 'string') {
              const idx = Number(evt.index || 0);
              const existing = pendingTools.get(idx);
              if (existing) existing.rawJson += evt.delta.partial_json;
            }
          } else if (evt.type === 'message_delta' && evt.usage) {
            usage = {
              outputTokens: typeof evt.usage.output_tokens === 'number' ? evt.usage.output_tokens : undefined,
            };
          }
        } catch {}
      }
    }

    const toolCalls: ChatToolCall[] = [];
    for (const tc of pendingTools.values()) {
      let args: Record<string, unknown> = {};
      try {
        args = tc.rawJson ? (JSON.parse(tc.rawJson) as Record<string, unknown>) : {};
      } catch {}
      if (tc.name) toolCalls.push({ id: tc.id, name: tc.name, arguments: args });
    }
    onChunk({
      done: true,
      engineLabel: `Claude (${model})`,
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(usage ? { usage } : {}),
    });
    return;
  }

  // OpenAI, OpenRouter, Groq
  const endpoint =
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://muxaro.vercel.app';
    headers['X-Title'] = 'MUXARO AI Studio';
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildOpenAiPayload(req, model, true)),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const errTxt = await resp.text().catch(() => '');
    throw new Error(sanitizeUpstreamError(errTxt || `${provider} HTTP ${resp.status}`, apiKey));
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const pendingTools = new Map<number, { id: string; name: string; rawArgs: string }>();
  let usage: NormalizedSseChunk['usage'];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const rawJson = line.slice(5).trim();
      if (!rawJson || rawJson === '[DONE]') continue;
      try {
        const delta = parseOpenAiSseDataLine(rawJson);
        if (delta.reasoning) onChunk({ reasoning: delta.reasoning });
        if (delta.token) onChunk({ token: delta.token });
        if (delta.usage) usage = delta.usage;
        if (delta.toolCallDeltas) {
          for (const d of delta.toolCallDeltas) {
            const cur = pendingTools.get(d.index) || {
              id: d.id || `call_oai_${d.index}`,
              name: '',
              rawArgs: '',
            };
            if (d.id) cur.id = d.id;
            if (d.name) cur.name += d.name;
            if (d.argumentsChunk) cur.rawArgs += d.argumentsChunk;
            pendingTools.set(d.index, cur);
          }
        }
      } catch {}
    }
  }

  const toolCalls: ChatToolCall[] = [];
  for (const tc of pendingTools.values()) {
    let args: Record<string, unknown> = {};
    try {
      args = tc.rawArgs ? (JSON.parse(tc.rawArgs) as Record<string, unknown>) : {};
    } catch {}
    if (tc.name) toolCalls.push({ id: tc.id, name: tc.name, arguments: args });
  }
  onChunk({
    done: true,
    engineLabel: `${provider.toUpperCase()} (${model})`,
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(usage ? { usage } : {}),
  });
}
