/**
 * @file session.ts
 * Session-based authentication utilities, token signing, and session lifecycle
 */

import type { Session, User, UserRole, PlanTier } from '../types.js';
import { generateId, createHmacSignature, verifyHmacSignature } from './crypto.js';
import { UnauthorizedError } from '../errors.js';
import { getDefaultTierForRole } from './rbac.js';

export interface CreateSessionOptions {
  userId?: string;
  role?: UserRole;
  tier?: PlanTier;
  ttlMs?: number;
  ipAddress?: string;
  userAgent?: string;
  isAnonymous?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SessionTokenPayload {
  sessionId: string;
  token: string; // The signed token string format: "sid.<sessionId>.<sig>"
}

export class SessionManager {
  private readonly secret: string;
  private readonly defaultTtlMs: number;

  constructor(options?: { secret?: string; defaultTtlMs?: number }) {
    this.secret = options?.secret || 'muxaro-dev-session-secret-change-in-production-12345';
    this.defaultTtlMs = options?.defaultTtlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
  }

  /**
   * Create a new session object for an authenticated or guest user.
   */
  public createSession(options: CreateSessionOptions = {}): { session: Session; token: string } {
    const now = Date.now();
    const sessionId = generateId('sess');
    const isAnon = options.isAnonymous ?? !options.userId;
    const userId = options.userId || (isAnon ? generateId('guest') : generateId('usr'));
    const role: UserRole = options.role || (isAnon ? 'anonymous' : 'free');
    const tier: PlanTier = options.tier || getDefaultTierForRole(role);
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;

    const session: Session = {
      sessionId,
      userId,
      role,
      tier,
      createdAt: now,
      expiresAt: now + ttlMs,
      lastActiveAt: now,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      metadata: {
        isAnonymous: isAnon,
        ...options.metadata,
      },
    };

    const token = this.signSessionToken(sessionId);
    return { session, token };
  }

  /**
   * Create an anonymous guest user session.
   */
  public createAnonymousSession(ipAddress?: string, userAgent?: string): { session: Session; token: string } {
    return this.createSession({
      isAnonymous: true,
      role: 'anonymous',
      tier: 'free',
      ipAddress,
      userAgent,
      metadata: { guest: true },
    });
  }

  /**
   * Sign a sessionId into a tamper-evident session token string.
   */
  public signSessionToken(sessionId: string): string {
    const raw = `muxaro.${sessionId}`;
    const sig = createHmacSignature(raw, this.secret);
    return `${sessionId}.${sig}`;
  }

  /**
   * Verify and extract the sessionId from a signed session token.
   * Throws UnauthorizedError if invalid or tampered with.
   */
  public parseAndVerifyToken(token: string): string {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedError('Missing or invalid session token');
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new UnauthorizedError('Malformed session token format');
    }

    const [sessionId, signature] = parts;
    if (!sessionId || !signature) {
      throw new UnauthorizedError('Malformed session token components');
    }

    const raw = `muxaro.${sessionId}`;
    let isValid = verifyHmacSignature(raw, signature, this.secret);
    if (!isValid) {
      // Fallback check for legacy vyro tokens
      const legacyRaw = `vyro.${sessionId}`;
      isValid = verifyHmacSignature(legacyRaw, signature, this.secret);
    }

    if (!isValid) {
      throw new UnauthorizedError('Session token signature verification failed (tampered or invalid)');
    }

    return sessionId;
  }

  /**
   * Validate session expiration and return updated active session.
   */
  public validateSession(session: Session | null | undefined, now: number = Date.now()): Session {
    if (!session) {
      throw new UnauthorizedError('Session does not exist or has been revoked');
    }

    if (now >= session.expiresAt) {
      throw new UnauthorizedError('Session has expired');
    }

    return session;
  }

  /**
   * Convert a validated session into a User model.
   */
  public sessionToUser(session: Session): User {
    return {
      id: session.userId,
      role: session.role,
      tier: session.tier,
      createdAt: session.createdAt,
      isAnonymous: Boolean(session.metadata?.['isAnonymous']),
      metadata: session.metadata,
    };
  }

  /**
   * Create standard HTTP Set-Cookie header value for the session.
   */
  public serializeCookie(token: string, options?: { maxAgeSeconds?: number; secure?: boolean; sameSite?: 'lax' | 'strict' | 'none' }): string {
    const maxAge = options?.maxAgeSeconds ?? Math.floor(this.defaultTtlMs / 1000);
    const secureFlag = options?.secure ? '; Secure' : '';
    const sameSite = options?.sameSite || 'lax';
    return `muxaro_session=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secureFlag}`;
  }

  /**
   * Parse session token from a standard Cookie header string.
   */
  public parseCookieHeader(cookieHeader?: string): string | null {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith('muxaro_session=')) {
        return c.substring('muxaro_session='.length);
      }
      if (c.startsWith('vyro_session=')) {
        return c.substring('vyro_session='.length);
      }
    }
    return null;
  }
}
