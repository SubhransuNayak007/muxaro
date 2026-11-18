/**
 * Project MUXARO - Authentication, Session, Guest Isolation, CSRF & Admin MFA Middleware
 *
 * Exports:
 * - resolveRequestAuth(request, reply?)
 * - verifyCsrf(request)
 * - requireAuth(request, reply)
 * - requireAdminMfa(request, reply)
 * - Cookie parsing & serialization helpers (zero external dependencies)
 */

import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db/database.js';
import { config } from '../config.js';
import {
  SESSION_TTL_MS,
  extractIpPrefix,
  hashToken,
  mapUserRow,
  recordSecurityEvent,
  timingSafeStringEqual,
  type PublicUserSummary,
  type SessionRecord,
} from '../services/auth.service.js';

export const SESSION_COOKIE_NAME = 'muxaro_session';
export const CSRF_COOKIE_NAME = 'muxaro_csrf';
export const GUEST_COOKIE_NAME = 'muxaro_guest';
export const OAUTH_STATE_COOKIE_NAME = 'muxaro_oauth_state';
export const CSRF_HEADER_NAME = 'x-muxaro-csrf';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const GUEST_ID_PATTERN = /^guest_[a-f0-9]{16,64}$/;
const LAST_SEEN_TOUCH_INTERVAL_MS = 60_000;

export interface RequestAuthContext {
  authenticated: boolean;
  user: PublicUserSummary | null;
  session: SessionRecord | null;
  guestId: string;
  authMethod: 'cookie' | 'bearer' | 'guest';
  actorId: string;
  tier: 'guest' | 'free' | 'premium';
  rawSessionToken?: string | null;
}

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  maxAge?: number;
  expires?: Date;
}

/**
 * Parses an HTTP Cookie header string into a key-value map.
 */
export function parseCookies(cookieHeader?: string | string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;

  const raw = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  const pairs = raw.split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Serializes a single RFC 6265 Set-Cookie header value.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);

  return parts.join('; ');
}

/**
 * Appends a Set-Cookie header without clobbering previously appended cookies.
 */
export function appendSetCookie(reply: FastifyReply, cookieString: string): void {
  const existing = reply.getHeader('set-cookie');
  if (!existing) {
    reply.header('Set-Cookie', [cookieString]);
  } else if (Array.isArray(existing)) {
    reply.header('Set-Cookie', [...existing.map(String), cookieString]);
  } else {
    reply.header('Set-Cookie', [String(existing), cookieString]);
  }
}

export function isSecureRequest(request?: FastifyRequest): boolean {
  if (config.env === 'production') return true;
  const forwardedProto = request?.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim() === 'https') {
    return true;
  }
  return request?.protocol === 'https';
}

export function setAuthCookies(
  reply: FastifyReply,
  sessionToken: string,
  csrfToken: string,
  secure: boolean
): void {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  appendSetCookie(
    reply,
    serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: maxAgeSec,
    })
  );
  appendSetCookie(
    reply,
    serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false, // Readable by frontend JS to send in x-muxaro-csrf header
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: maxAgeSec,
    })
  );
}

export function clearAuthCookies(reply: FastifyReply, secure: boolean): void {
  const past = new Date(0);
  appendSetCookie(
    reply,
    serializeCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 0,
      expires: past,
    })
  );
  appendSetCookie(
    reply,
    serializeCookie(CSRF_COOKIE_NAME, '', {
      httpOnly: false,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 0,
      expires: past,
    })
  );
}

export function setGuestCookie(reply: FastifyReply, guestId: string, secure: boolean): void {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  appendSetCookie(
    reply,
    serializeCookie(GUEST_COOKIE_NAME, guestId, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: maxAgeSec,
    })
  );
}

interface SessionUserJoinRow {
  session_id: string;
  session_user_id: string;
  csrf_token: string;
  mfa_verified: number;
  user_agent: string | null;
  ip_prefix: string | null;
  session_created_at: string;
  last_seen_at: string;
  expires_at: string;
  // User columns
  id: string;
  public_user_id: string;
  email: string;
  email_verified: number;
  password_hash: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  tier: string;
  account_status: string;
  preferences_json: string | null;
  mfa_enabled: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const REQUEST_AUTH_SYMBOL = Symbol('muxaroAuthContext');

/**
 * Resolves authentication state for any incoming request.
 * Reads `muxaro_session` cookie (preferred) or `Authorization: Bearer <token>`, hashes with SHA-256,
 * and validates against active non-revoked/non-expired `user_sessions` + active `users` row.
 * Falls back to a cryptographic guest session ID (`muxaro_guest` cookie) for unauthenticated visitors.
 */
export function resolveRequestAuth(
  request: FastifyRequest,
  reply?: FastifyReply
): RequestAuthContext {
  const cached = (request as unknown as Record<symbol, RequestAuthContext | undefined>)[
    REQUEST_AUTH_SYMBOL
  ];
  if (cached) {
    return cached;
  }

  const cookies = parseCookies(request.headers.cookie);
  const cookieSessionToken = cookies[SESSION_COOKIE_NAME];
  const authHeader = request.headers.authorization;
  const bearerToken =
    typeof authHeader === 'string' && /^Bearer\s+/i.test(authHeader)
      ? authHeader.replace(/^Bearer\s+/i, '').trim()
      : null;

  const rawToken = cookieSessionToken || bearerToken || null;
  const authMethod: 'cookie' | 'bearer' | 'guest' = cookieSessionToken
    ? 'cookie'
    : bearerToken
      ? 'bearer'
      : 'guest';

  // Resolve or allocate cryptographic guest ID for unauthenticated isolation
  const existingGuestCookie = cookies[GUEST_COOKIE_NAME];
  let guestId: string;
  let shouldSetGuestCookie = false;
  if (existingGuestCookie && GUEST_ID_PATTERN.test(existingGuestCookie)) {
    guestId = existingGuestCookie;
  } else {
    guestId = `guest_${crypto.randomBytes(16).toString('hex')}`;
    shouldSetGuestCookie = true;
  }

  if (rawToken) {
    try {
      const db = getDb();
      const tokenHash = hashToken(rawToken);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const row = db
        .prepare(
          `SELECT
             s.id AS session_id,
             s.user_id AS session_user_id,
             s.csrf_token,
             s.mfa_verified,
             s.user_agent,
             s.ip_prefix,
             s.created_at AS session_created_at,
             s.last_seen_at,
             s.expires_at,
             u.id,
             u.public_user_id,
             u.email,
             u.email_verified,
             u.password_hash,
             u.display_name,
             u.avatar_url,
             u.role,
             u.tier,
             u.account_status,
             u.preferences_json,
             u.mfa_enabled,
             u.created_at,
             u.updated_at,
             u.deleted_at
           FROM user_sessions s
           INNER JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ?
             AND s.revoked_at IS NULL
             AND s.expires_at > ?
             AND u.deleted_at IS NULL
             AND u.account_status = 'ACTIVE'`
        )
        .get(tokenHash, nowIso) as unknown as SessionUserJoinRow | undefined;

      if (row) {
        // Throttled last_seen_at update
        const lastSeenMs = Date.parse(row.last_seen_at);
        if (!Number.isFinite(lastSeenMs) || nowMs - lastSeenMs > LAST_SEEN_TOUCH_INTERVAL_MS) {
          try {
            db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?').run(
              nowIso,
              row.session_id
            );
          } catch {
            // Non-blocking activity touch
          }
        }

        const mfaVerified = Boolean(row.mfa_verified);
        const user = mapUserRow(row, mfaVerified);
        const session: SessionRecord = {
          id: row.session_id,
          userId: row.session_user_id,
          csrfToken: row.csrf_token,
          mfaVerified,
          userAgent: row.user_agent,
          ipPrefix: row.ip_prefix,
          createdAt: row.session_created_at,
          lastSeenAt: nowIso,
          expiresAt: row.expires_at,
        };

        const ctx: RequestAuthContext = {
          authenticated: true,
          user,
          session,
          guestId,
          authMethod,
          actorId: user.id,
          tier: user.tier,
          rawSessionToken: rawToken,
        };

        (request as unknown as Record<symbol, RequestAuthContext>)[REQUEST_AUTH_SYMBOL] = ctx;
        return ctx;
      }
    } catch {
      // Fall through cleanly to guest context on malformed/unmatched tokens
    }
  }

  if (shouldSetGuestCookie && reply && !reply.sent) {
    setGuestCookie(reply, guestId, isSecureRequest(request));
  }

  const guestCtx: RequestAuthContext = {
    authenticated: false,
    user: null,
    session: null,
    guestId,
    authMethod: 'guest',
    actorId: guestId,
    tier: 'guest',
    rawSessionToken: null,
  };

  (request as unknown as Record<symbol, RequestAuthContext>)[REQUEST_AUTH_SYMBOL] = guestCtx;
  return guestCtx;
}

/**
 * Clears cached auth context on the request (useful after session mutation within same request).
 */
export function clearRequestAuthCache(request: FastifyRequest): void {
  delete (request as unknown as Record<symbol, RequestAuthContext | undefined>)[REQUEST_AUTH_SYMBOL];
}

/**
 * Verifies CSRF protection on state-mutating cookie-authenticated requests.
 * Requires `x-muxaro-csrf` header to match both the server-side session CSRF token and `muxaro_csrf` cookie.
 */
export function verifyCsrf(request: FastifyRequest): boolean {
  const method = (request.method || 'GET').toUpperCase();
  if (SAFE_HTTP_METHODS.has(method)) {
    return true;
  }

  const auth = resolveRequestAuth(request);
  // Bearer-authenticated API requests are immune to browser cookie CSRF
  if (auth.authMethod === 'bearer') {
    return true;
  }
  // Unauthenticated guest requests without a session cookie do not carry session credentials
  if (!auth.authenticated || !auth.session) {
    return true;
  }

  const headerRaw = request.headers[CSRF_HEADER_NAME];
  const headerToken = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
  if (!headerToken || typeof headerToken !== 'string') {
    return false;
  }

  const trimmedHeader = headerToken.trim();
  if (!trimmedHeader) {
    return false;
  }

  // Must match server-side session CSRF token (synchronizer token check)
  if (!timingSafeStringEqual(trimmedHeader, auth.session.csrfToken)) {
    return false;
  }

  // Double-submit check: if muxaro_csrf cookie is present, it must also match
  const cookies = parseCookies(request.headers.cookie);
  const cookieCsrf = cookies[CSRF_COOKIE_NAME];
  if (cookieCsrf && !timingSafeStringEqual(trimmedHeader, cookieCsrf)) {
    return false;
  }

  return true;
}

/**
 * Fastify preHandler / imperative guard requiring an authenticated user (+ CSRF on mutating cookie requests).
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<RequestAuthContext | void> {
  const requestId = (request.id as string) || `req_${Date.now()}`;
  const auth = resolveRequestAuth(request, reply);

  if (!auth.authenticated || !auth.user || !auth.session) {
    reply.code(401).send({
      success: false,
      error: {
        code: 'ERR_UNAUTHORIZED',
        message: 'Authentication is required to access this resource.',
        details: null,
      },
      requestId,
    });
    return;
  }

  if (!verifyCsrf(request)) {
    recordSecurityEvent({
      eventType: 'CSRF_REJECTED',
      severity: 'HIGH',
      userId: auth.user.id,
      publicUserId: auth.user.publicUserId,
      ipPrefix: extractIpPrefix(request.ip),
      endpoint: request.url,
      requestId,
    });
    reply.code(403).send({
      success: false,
      error: {
        code: 'ERR_CSRF_INVALID',
        message: 'Invalid or missing CSRF verification token.',
        details: null,
      },
      requestId,
    });
    return;
  }

  return auth;
}

/**
 * Fastify preHandler / imperative guard requiring an authenticated ADMIN user with verified TOTP MFA.
 */
export async function requireAdminMfa(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<RequestAuthContext | void> {
  const auth = await requireAuth(request, reply);
  if (!auth || reply.sent || !auth.user || !auth.session) {
    return;
  }

  const requestId = (request.id as string) || `req_${Date.now()}`;

  if (auth.user.role !== 'admin') {
    recordSecurityEvent({
      eventType: 'ADMIN_ACCESS_DENIED',
      severity: 'HIGH',
      userId: auth.user.id,
      publicUserId: auth.user.publicUserId,
      ipPrefix: extractIpPrefix(request.ip),
      endpoint: request.url,
      requestId,
    });
    reply.code(403).send({
      success: false,
      error: {
        code: 'ERR_ADMIN_REQUIRED',
        message: 'Administrator privileges are required to access this resource.',
        details: null,
      },
      requestId,
    });
    return;
  }

  if (!auth.user.mfaEnabled || !auth.session.mfaVerified) {
    recordSecurityEvent({
      eventType: 'ADMIN_MFA_REQUIRED',
      severity: 'MEDIUM',
      userId: auth.user.id,
      publicUserId: auth.user.publicUserId,
      ipPrefix: extractIpPrefix(request.ip),
      endpoint: request.url,
      requestId,
      details: {
        mfaEnabled: auth.user.mfaEnabled,
        mfaVerified: auth.session.mfaVerified,
      },
    });
    reply.code(403).send({
      success: false,
      error: {
        code: 'ERR_ADMIN_MFA_REQUIRED',
        message: 'Two-factor authentication verification is required for administrator access.',
        details: {
          mfaEnabled: auth.user.mfaEnabled,
          mfaVerified: auth.session.mfaVerified,
        },
      },
      requestId,
    });
    return;
  }

  return auth;
}
