import { NextRequest, NextResponse } from 'next/server';

let preferencesCache = {
  ecoMode: false,
  autoDownload: true,
  defaultFormat: 'mp4',
  defaultQuality: '1080p',
};

export async function GET() {
  return NextResponse.json({
    success: true,
    data: preferencesCache,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    preferencesCache = { ...preferencesCache, ...body };
    return NextResponse.json({
      success: true,
      data: preferencesCache,
    });
  } catch {
    return NextResponse.json({ success: true, data: preferencesCache });
  }
}
