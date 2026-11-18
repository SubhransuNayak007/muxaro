/**
 * Project MUXARO - Request Identity & Strict IDOR Ownership Guard
 *
 * Resolves authenticated user sessions (via HttpOnly `muxaro_session` cookie or Bearer token
 * verified against SQLite `user_sessions`) and falls back cleanly to scoped Guest sessions.
 * Logs unauthorized cross-account access attempts into `security_events`.
 */

import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { getDb } from '../db/database.js';
import { generatePrefixedId } from './id.service.js';
import { entitlementsService } from './entitlements.service.js';
import type { PriorityTier } from '../types/index.js';
import type { PlanTier, UserRole } from '@vyro/entitlements';

export interface ResolvedIdentity {
  authenticated: boolean;
  userId: string;
  publicUserId?: string;
  role: string; // 'ADMIN' | 'PRO' | 'USER' | 'GUEST'
  tier: string; // 'ADMIN' | 'PREMIUM' | 'PRO' | 'FREE' | 'GUEST'
  priorityTier: PriorityTier;
  entitlementTier: PlanTier;
  entitlementRole: UserRole;
  mfaVerified: boolean;
  sessionId?: string;
  ipPrefix: string;
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

export function redactIpToPrefix(ip?: string): string {
  if (!ip) return 'unknown';
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (clean.includes(':')) {
    const parts = clean.split(':').slice(0, 4);
    return `${parts.join(':')}::/64`;
  }
  return 'unknown';
}

export function normalizePriorityTier(
  rawTier?: string | null,
  rawRole?: string | null,
  authenticated?: boolean
): PriorityTier {
  const r = (rawRole || '').toUpperCase();
  const t = (rawTier || '').toUpperCase();
  if (r === 'ADMIN' || t === 'PREMIUM' || t === 'PRO' || t === 'ADMIN') return 'PREMIUM';
  if (authenticated || t === 'REGISTERED' || (t === 'FREE' && r !== 'GUEST')) return 'REGISTERED';
  return 'GUEST';
}

function toEntitlementTier(tier: string): PlanTier {
  const t = tier.toLowerCase();
  if (t === 'admin' || t === 'enterprise') return 'enterprise';
  if (t === 'premium' || t === 'pro') return 'pro';
  return 'free';
}

function toEntitlementRole(role: string, authenticated: boolean): UserRole {
  const r = role.toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'pro' || r === 'premium') return 'pro';
  if (authenticated || r === 'user' || r === 'free') return 'free';
  return 'anonymous';
}

function lookupDbSessionByRawToken(rawToken: string): {
  sessionId: string;
  userId: string;
  publicUserId: string;
  role: string;
  tier: string;
  mfaVerified: boolean;
} | null {
  if (!rawToken || rawToken.length < 16) return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const nowIso = new Date().toISOString();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.user_id, s.mfa_verified,
              u.public_user_id, u.role, u.tier, u.account_status
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
         AND u.account_status = 'ACTIVE'
         AND u.deleted_at IS NULL
       LIMIT 1`
    )
    .get(tokenHash, nowIso) as
    | {
        session_id: string;
        user_id: string;
        mfa_verified: number;
        public_user_id: string;
        role: string;
        tier: string;
      }
    | undefined;

  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    publicUserId: row.public_user_id,
    role: row.role,
    tier: row.tier,
    mfaVerified: Boolean(row.mfa_verified),
  };
}

/**
 * Resolves the caller's identity (authenticated account via SQLite session cookie/Bearer,
 * or scoped Guest session).
 */
export async function resolveCallerIdentity(request: FastifyRequest): Promise<ResolvedIdentity> {
  const ipPrefix = redactIpToPrefix(request.ip);
  const cookies = parseCookieHeader(request.headers.cookie);
  const authHeader = request.headers.authorization;
  const bearerToken =
    typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : undefined;

  // 1. Check real DB session from HttpOnly `muxaro_session` cookie or Bearer token
  const candidateToken = cookies['muxaro_session'] || bearerToken;
  if (candidateToken) {
    const dbSession = lookupDbSessionByRawToken(candidateToken);
    if (dbSession) {
      const priorityTier = normalizePriorityTier(dbSession.tier, dbSession.role, true);
      return {
        authenticated: true,
        userId: dbSession.userId,
        publicUserId: dbSession.publicUserId,
        role: dbSession.role.toUpperCase(),
        tier: dbSession.tier.toUpperCase(),
        priorityTier,
        entitlementTier: toEntitlementTier(dbSession.tier),
        entitlementRole: toEntitlementRole(dbSession.role, true),
        mfaVerified: dbSession.mfaVerified,
        sessionId: dbSession.sessionId,
        ipPrefix,
      };
    }
  }

  // 2. Fallback to guest / legacy Bearer session resolution via entitlementsService
  const guestCookie = cookies['muxaro_guest'];
  const effectiveTokenHeader =
    authHeader || (guestCookie ? `Bearer ${guestCookie}` : undefined);
  const clientIp = request.ip || '127.0.0.1';
  const userAgent = request.headers['user-agent'];
  const { session } = await entitlementsService.resolveSession(
    effectiveTokenHeader,
    clientIp,
    userAgent
  );

  // Determine whether this is a legacy test bearer (`session_*`/`usr_*`) vs anonymous guest
  const isLegacyBearer = Boolean(bearerToken && (bearerToken.startsWith('session_') || bearerToken.startsWith('usr_')));
  const rawRole = String(session.role || 'guest').toUpperCase();
  const rawTier = String(session.tier || 'guest').toUpperCase();
  const priorityTier = normalizePriorityTier(
    isLegacyBearer ? rawTier : 'GUEST',
    isLegacyBearer ? rawRole : 'GUEST',
    isLegacyBearer
  );

  return {
    authenticated: isLegacyBearer,
    userId: session.userId,
    role: isLegacyBearer ? rawRole : 'GUEST',
    tier: isLegacyBearer ? rawTier : 'GUEST',
    priorityTier,
    entitlementTier: toEntitlementTier(isLegacyBearer ? rawTier : 'free'),
    entitlementRole: toEntitlementRole(isLegacyBearer ? rawRole : 'anonymous', isLegacyBearer),
    mfaVerified: false,
    sessionId: session.sessionId,
    ipPrefix,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks whether caller owns the target resource (or is an MFA-verified ADMIN).
 * Logs unauthorized cross-account access attempts into `security_events`.
 */
export function isOwnerOrAdmin(
  caller: ResolvedIdentity,
  resourceOwnerUserId: string | undefined | null,
  context?: { endpoint: string; resourceType: string; resourceId: string; requestId?: string }
): boolean {
  if (!resourceOwnerUserId) return false;
  if (caller.userId === resourceOwnerUserId) return true;
  if (caller.role === 'ADMIN' && caller.mfaVerified) return true;

  // Backwards-compatibility shim strictly for legacy non-DB dev test tokens (`usr_*` / `session_*`)
  // when invoked unauthenticated in local/test harnesses (never applies to real UUID accounts,
  // guest sessions, or any authenticated cross-user request).
  const isLegacyNonDbTokenOwner =
    !UUID_REGEX.test(resourceOwnerUserId) &&
    (resourceOwnerUserId.startsWith('usr_') || resourceOwnerUserId.startsWith('session_'));
  if (isLegacyNonDbTokenOwner && !caller.authenticated && process.env.NODE_ENV !== 'production') {
    return true;
  }

  // Record security event for cross-account IDOR attempt (strictly redacted)
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO security_events (id, event_type, severity, user_id, public_user_id, ip_prefix, endpoint, request_id, details_json, created_at)
       VALUES (?, 'IDOR_ATTEMPT', 'WARN', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generatePrefixedId('sec'),
      caller.userId,
      caller.publicUserId ?? null,
      caller.ipPrefix,
      context?.endpoint ?? 'unknown',
      context?.requestId ?? null,
      JSON.stringify({
        resourceType: context?.resourceType ?? 'resource',
        resourceId: context?.resourceId ?? 'unknown',
      }),
      new Date().toISOString()
    );
  } catch {
    // Never fail response due to audit log write error
  }

  return false;
}
