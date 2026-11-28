import { NextRequest, NextResponse } from 'next/server';
import {
  ChatCompletionRequestSchema,
  checkTrialRateLimit,
  sanitizeUpstreamError,
  streamProviderChat,
  type AiProviderId,
} from '@/lib/ai/server/provider-adapters';

export const runtime = 'nodejs';
export const maxDuration = 60;

function resolveServerTrialKey(): { provider: AiProviderId; apiKey: string } | null {
  const trialKey = (process.env.MUXARO_PUBLIC_TRIAL_AI_KEY || '').trim();
  if (!trialKey) return null;
  const trialProviderRaw = (process.env.MUXARO_PUBLIC_TRIAL_AI_PROVIDER || 'gemini').trim().toLowerCase();
  const provider: AiProviderId =
    trialProviderRaw === 'openai' ||
    trialProviderRaw === 'anthropic' ||
    trialProviderRaw === 'openrouter' ||
    trialProviderRaw === 'groq'
      ? trialProviderRaw
      : 'gemini';
  return { provider, apiKey: trialKey };
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => null);
    const parsed = ChatCompletionRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_REQUEST', message: 'Invalid chat payload.' },
        { status: 400 }
      );
    }

    const byokHeader = (req.headers.get('x-muxaro-byok') || '').trim();
    let effectiveProvider: AiProviderId = parsed.data.provider;
    let apiKey = byokHeader;
    let effectiveRequest = parsed.data;

    if (!apiKey) {
      const trial = resolveServerTrialKey();
      if (!trial) {
        return NextResponse.json(
          {
            ok: false,
            code: 'BYOK_OR_LOCAL_REQUIRED',
            message:
              'Add your own API key in Settings -> AI & Memory, or switch to WebGPU Local SLM (zero cost, runs in browser).',
          },
          { status: 401 }
        );
      }

      const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'anonymous';
      const rl = checkTrialRateLimit(`trial:${ip}`, 10);
      if (!rl.allowed) {
        return NextResponse.json(
          {
            ok: false,
            code: 'TRIAL_RATE_LIMIT',
            message: `Public trial quota reached. Retry in ${rl.resetAfterSec}s or add your own API key.`,
          },
          { status: 429, headers: { 'Retry-After': String(rl.resetAfterSec) } }
        );
      }

      effectiveProvider = trial.provider;
      apiKey = trial.apiKey;
      effectiveRequest = {
        ...parsed.data,
        provider: trial.provider,
        model: undefined,
        maxTokens: Math.min(2048, parsed.data.maxTokens ?? 1800),
      };
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        try {
          await streamProviderChat({
            request: { ...effectiveRequest, provider: effectiveProvider },
            apiKey,
            signal: req.signal,
            onChunk: (chunk) => emit(chunk as unknown as Record<string, unknown>),
          });
        } catch (err) {
          emit({
            error: sanitizeUpstreamError(
              err instanceof Error ? err.message : String(err),
              apiKey
            ),
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, code: 'INTERNAL_ERROR', message: sanitizeUpstreamError(String(err)) },
      { status: 500 }
    );
  }
}
