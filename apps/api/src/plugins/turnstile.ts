/**
 * Project MUXARO - Cloudflare Turnstile Server Verification Hook
 *
 * Protects costly /probe, /jobs, and /tunnel endpoints against automated scraping bursts
 * when TURNSTILE_SECRET_KEY is configured in production.
 * Non-blocking when unconfigured (local dev, test suites, private self-hosted Docker).
 */

import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verifySignedTurnstileSession(sessionToken: string): boolean {
  const secret = process.env.TURNSTILE_SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret || !sessionToken) return false;
  const parts = sessionToken.split('.');
  if (parts.length !== 3) return false;
  const [header, payloadB64, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payloadB64}`)
    .digest('base64url');
  if (!timingSafeEqualStr(expectedSig, sig)) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    return typeof payload?.exp === 'number' && payload.exp > now;
  } catch {
    return false;
  }
}

export async function requireTurnstileIfConfigured(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;

  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secretKey) return;

  // Internal trusted service-to-service bypass if configured
  const internalKey = process.env.INTERNAL_API_KEY?.trim();
  const reqInternalKey = String(request.headers['x-internal-api-key'] || '').trim();
  if (internalKey && reqInternalKey && timingSafeEqualStr(internalKey, reqInternalKey)) {
    return;
  }

  // Verified Turnstile 5-minute session JWT
  const sessionJwt = String(
    request.headers['x-muxaro-turnstile-session'] ||
      (request.body as any)?.turnstileSession ||
      ''
  ).trim();
  if (sessionJwt && verifySignedTurnstileSession(sessionJwt)) {
    return;
  }

  const cfToken = String(
    request.headers['x-turnstile-token'] ||
      request.headers['cf-turnstile-response'] ||
      (request.body as any)?.turnstileToken ||
      (request.query as any)?.turnstileToken ||
      ''
  ).trim();

  if (!cfToken) {
    reply.code(403).send({
      success: false,
      error: {
        code: 'ERR_TURNSTILE_REQUIRED',
        message: 'Human verification token is required for public cloud extraction.',
      },
      requestId: request.id,
    });
    return;
  }

  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: cfToken,
      ...(request.ip ? { remoteip: request.ip } : {}),
    });

    const verifyRes = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });

    if (!verifyRes.ok) {
      reply.code(502).send({
        success: false,
        error: {
          code: 'ERR_TURNSTILE_UPSTREAM',
          message: 'Turnstile verification service unavailable.',
        },
        requestId: request.id,
      });
      return;
    }

    const result = (await verifyRes.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (!result.success) {
      reply.code(403).send({
        success: false,
        error: {
          code: 'ERR_TURNSTILE_FAILED',
          message: `Verification failed (${(result['error-codes'] || []).join(', ') || 'invalid token'}).`,
        },
        requestId: request.id,
      });
      return;
    }
  } catch {
    reply.code(502).send({
      success: false,
      error: {
        code: 'ERR_TURNSTILE_UPSTREAM',
        message: 'Failed to reach Turnstile verification service.',
      },
      requestId: request.id,
    });
  }
}
