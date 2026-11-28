import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSafePublicUrl } from '@/lib/ai/server/ssrf-guard';

export const runtime = 'nodejs';
export const maxDuration = 30;

const McpReqSchema = z.object({
  serverUrl: z.string().url().max(1024),
  method: z.enum(['tools/list', 'tools/call', 'resources/list', 'resources/read']),
  params: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = McpReqSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid MCP request.' }, { status: 400 });
  }

  try {
    const targetUrl = await assertSafePublicUrl(parsed.data.serverUrl);
    const bearer = (req.headers.get('x-muxaro-mcp-auth') || '').trim();
    const upstreamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (bearer) {
      upstreamHeaders.Authorization = bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`;
    }

    const upstream = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: parsed.data.method,
        params: parsed.data.params || {},
      }),
      signal: AbortSignal.timeout(15000),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `MCP server HTTP ${upstream.status}: ${text.slice(0, 260)}` },
        { status: upstream.status }
      );
    }

    // Parse JSON or SSE single-message MCP response
    let rpcResult: unknown = null;
    try {
      rpcResult = JSON.parse(text);
    } catch {
      const dataLines = text
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .filter(Boolean);
      const last = dataLines[dataLines.length - 1];
      if (last) rpcResult = JSON.parse(last);
    }

    return NextResponse.json({ ok: true, rpc: rpcResult });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'MCP relay failed.' },
      { status: 400 }
    );
  }
}
