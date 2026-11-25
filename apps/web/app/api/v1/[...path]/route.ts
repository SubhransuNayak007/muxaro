import { NextRequest, NextResponse } from 'next/server';
import {
  isServerlessRuntime,
  proxyToBackend,
  resolveBackendBaseUrl,
} from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Disposition, Content-Range, Content-Length, Accept-Ranges, ETag',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

async function handleProxy(
  req: NextRequest,
  context: { params: { path: string[] } }
) {
  const segments = context.params?.path || [];
  const subpath = segments.join('/');
  const isStreaming =
    subpath.endsWith('/events') ||
    subpath.endsWith('/download') ||
    subpath.endsWith('/download.zip');

  const upstream = await proxyToBackend(req, subpath, { streaming: isStreaming });
  if (upstream) return upstream;

  const isServerless = isServerlessRuntime();
  return NextResponse.json(
    {
      ok: false,
      success: false,
      code: 'ERR_BACKEND_NOT_CONFIGURED',
      status: 503,
      rawMessage: `Endpoint /api/v1/${subpath} requires a live backend API (API_INTERNAL_URL is not configured).`,
      error: {
        code: 'ERR_BACKEND_NOT_CONFIGURED',
        message: isServerless
          ? `Backend API not connected for /api/v1/${subpath}. Configure API_INTERNAL_URL / NEXT_PUBLIC_API_URL in Vercel project environment variables.`
          : `No external backend configured and no local Next.js handler exists for /api/v1/${subpath}.`,
      },
      backendConnected: Boolean(resolveBackendBaseUrl()),
      requestId: `bff_${Date.now()}`,
    },
    { status: 503, headers: CORS_HEADERS }
  );
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handleProxy(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handleProxy(req, ctx);
}

export async function PUT(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handleProxy(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handleProxy(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handleProxy(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: { params: { path: string[] } }) {
  return handleProxy(req, ctx);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
