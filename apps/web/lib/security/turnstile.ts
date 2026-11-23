/**
 * MUXARO Cloudflare Turnstile Verification & 5-Minute Session JWT Helper
 * Protects endpoints from bot scraping, DDoS, and automated abuse.
 * Issues and validates signed 5-minute session JWTs upon human challenge completion.
 */

import crypto from 'node:crypto';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FIVE_MINUTES_SECONDS = 300; // 5 minutes

export interface TurnstileVerifyResult {
  success: boolean;
  error?: string;
  errorCodes?: string[];
  challengeTs?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

export interface TurnstileSessionJwtPayload {
  sub?: string;
  ip?: string;
  verified: boolean;
  iat: number;
  exp: number;
  jti?: string;
  turnstileHostname?: string;
  [key: string]: unknown;
}

/**
 * Resolves the signing secret for Turnstile session JWTs.
 */
function resolveJwtSecret(): string {
  const secret =
    process.env.SESSION_JWT_SECRET ||
    process.env.TURNSTILE_SECRET_KEY ||
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ||
    process.env.INTERNAL_API_SECRET;

  if (secret && secret.trim().length >= 16) {
    return secret.trim();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_JWT_SECRET or TURNSTILE_SECRET_KEY must be configured in production.');
  }

  // Safe fallback for local development & test
  return 'muxaro-dev-turnstile-session-signing-secret-32-bytes-minimum';
}

/**
 * Base64URL encoding helper.
 */
function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Base64URL decoding helper.
 */
function fromBase64Url(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Verifies a Cloudflare Turnstile token via Cloudflare's siteverify API.
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<TurnstileVerifyResult> {
  const trimmedToken = String(token || '').trim();
  if (!trimmedToken) {
    return { success: false, error: 'Turnstile verification token is missing.' };
  }

  // Allow bypass for automated test suites or Cloudflare's documented dummy test token
  if (
    process.env.NODE_ENV === 'test' ||
    trimmedToken === 'XXXX.DUMMY.TOKEN.XXXX' ||
    trimmedToken === 'test-turnstile-token'
  ) {
    return {
      success: true,
      hostname: 'localhost',
      challengeTs: new Date().toISOString(),
    };
  }

  const secretKey =
    process.env.TURNSTILE_SECRET_KEY ||
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    if (process.env.NODE_ENV === 'development') {
      // In local dev without Cloudflare keys, allow graceful fallback
      return {
        success: true,
        hostname: 'localhost',
        challengeTs: new Date().toISOString(),
      };
    }
    return {
      success: false,
      error: 'Turnstile secret key is not configured on the server.',
    };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey.trim());
    formData.append('response', trimmedToken);
    if (remoteIp) {
      formData.append('remoteip', remoteIp.trim());
    }

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: formData.toString(),
    });

    if (!res.ok) {
      return {
        success: false,
        error: `Cloudflare Turnstile API returned HTTP status ${res.status}.`,
      };
    }

    const data = await res.json();
    if (data.success === true) {
      return {
        success: true,
        challengeTs: data.challenge_ts,
        hostname: data.hostname,
        action: data.action,
        cdata: data.cdata,
      };
    }

    const errorCodes = Array.isArray(data['error-codes'])
      ? data['error-codes']
      : ['invalid-input-response'];

    return {
      success: false,
      error: `Turnstile verification failed: ${errorCodes.join(', ')}`,
      errorCodes,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown network error';
    return {
      success: false,
      error: `Failed to connect to Cloudflare Turnstile service: ${msg}`,
    };
  }
}

/**
 * Creates an HMAC-SHA256 signed JWT with a strict 5-minute lifespan.
 */
export function createSessionJwt(
  payload: Partial<TurnstileSessionJwtPayload>,
  customSecret?: string
): string {
  const secret = customSecret || resolveJwtSecret();
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const fullPayload: TurnstileSessionJwtPayload = {
    sub: payload.sub || 'anonymous-human',
    verified: payload.verified ?? true,
    iat: payload.iat || now,
    exp: payload.exp || now + FIVE_MINUTES_SECONDS,
    jti: payload.jti || crypto.randomUUID(),
    ...payload,
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(fullPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest();

  const encodedSignature = toBase64Url(signature);
  return `${dataToSign}.${encodedSignature}`;
}

/**
 * Cryptographically verifies an HMAC-SHA256 JWT and checks that it has not expired.
 * Returns the parsed payload if valid, or null if invalid or expired.
 */
export function verifySessionJwt(
  jwtString: string,
  customSecret?: string
): TurnstileSessionJwtPayload | null {
  if (!jwtString || typeof jwtString !== 'string') return null;

  const parts = jwtString.trim().split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  try {
    const secret = customSecret || resolveJwtSecret();
    const dataToVerify = `${encodedHeader}.${encodedPayload}`;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(dataToVerify)
      .digest();

    const actualSignature = Buffer.from(
      encodedSignature.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    );

    if (
      actualSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(actualSignature, expectedSignature)
    ) {
      return null;
    }

    const header = JSON.parse(fromBase64Url(encodedHeader));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }

    const payload: TurnstileSessionJwtPayload = JSON.parse(fromBase64Url(encodedPayload));
    const now = Math.floor(Date.now() / 1000);

    // Strict 5-minute expiry validation (with 5-second clock drift allowance)
    if (typeof payload.exp !== 'number' || now > payload.exp + 5) {
      return null;
    }

    // Must be verified
    if (payload.verified !== true) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Issues a 5-minute session token after successful Turnstile verification.
 */
export function issueTurnstileSessionToken(options?: {
  ip?: string;
  sub?: string;
  hostname?: string;
  customClaims?: Record<string, unknown>;
}): string {
  const now = Math.floor(Date.now() / 1000);
  return createSessionJwt({
    sub: options?.sub || 'turnstile-verified-user',
    ip: options?.ip,
    turnstileHostname: options?.hostname,
    verified: true,
    iat: now,
    exp: now + FIVE_MINUTES_SECONDS, // exactly 5 minutes
    ...(options?.customClaims || {}),
  });
}

/**
 * Verifies a 5-minute Turnstile session token. Optionally validates IP matching.
 */
export function verifyTurnstileSessionToken(
  token: string,
  remoteIp?: string
): { valid: boolean; payload?: TurnstileSessionJwtPayload; error?: string } {
  const payload = verifySessionJwt(token);
  if (!payload) {
    return { valid: false, error: 'Session token is invalid or expired (5-minute limit).' };
  }

  // If token is bound to an IP, verify IP match
  if (payload.ip && remoteIp && payload.ip.trim() !== remoteIp.trim()) {
    return { valid: false, error: 'Session token IP mismatch.' };
  }

  return { valid: true, payload };
}
