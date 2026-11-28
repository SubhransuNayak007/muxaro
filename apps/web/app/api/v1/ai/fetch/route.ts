import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchReadableWebPage } from '@/lib/ai/server/web-research';

export const runtime = 'nodejs';
export const maxDuration = 30;

const FetchReqSchema = z.object({
  url: z.string().url().max(2048),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = FetchReqSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'A valid HTTP(S) URL is required.' }, { status: 400 });
  }

  try {
    const page = await fetchReadableWebPage(parsed.data.url);
    return NextResponse.json({ ok: true, page });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unable to fetch web page safely.' },
      { status: 400 }
    );
  }
}
