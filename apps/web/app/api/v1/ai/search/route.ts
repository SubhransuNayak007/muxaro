import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { searchWebSources } from '@/lib/ai/server/web-research';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SearchReqSchema = z.object({
  query: z.string().min(2).max(400),
  limit: z.number().int().min(1).max(10).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SearchReqSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Search query must be 2–400 chars.' }, { status: 400 });
  }

  try {
    const result = await searchWebSources(parsed.data.query, {
      limit: parsed.data.limit,
      tavilyKey: req.headers.get('x-muxaro-tavily-key') || undefined,
      braveKey: req.headers.get('x-muxaro-brave-key') || undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Search failed.' },
      { status: 500 }
    );
  }
}
