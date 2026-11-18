/**
 * @file auth-rbac.test.ts
 * Tests for session-based authentication utilities, token signing, and RBAC role checks
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementsEngine } from '../src/engine.js';
import { UnauthorizedError, ForbiddenError } from '../src/errors.js';
import { isRoleAtLeast, hasPermission } from '../src/auth/rbac.js';

describe('Authentication & RBAC Engine', () => {
  it('creates, signs, and validates user sessions', async () => {
    const engine = new EntitlementsEngine(undefined, {
      sessionSecret: 'super-secret-test-key-54321',
    });

    const { session, token } = await engine.createSession({
      userId: 'usr_auth_alice',
      role: 'free',
      tier: 'free',
      ipAddress: '203.0.113.195',
      userAgent: 'Mozilla/5.0 MuxaroClient/1.0',
    });

    assert.ok(token.includes('.'));
    assert.equal(session.userId, 'usr_auth_alice');
    assert.equal(session.role, 'free');

    // Authenticate with valid token
    const validated = await engine.authenticateToken(token);
    assert.equal(validated.userId, 'usr_auth_alice');
    assert.equal(validated.sessionId, session.sessionId);
  });

  it('detects token tampering and rejects with UnauthorizedError', async () => {
    const engine = new EntitlementsEngine(undefined, {
      sessionSecret: 'super-secret-test-key-54321',
    });

    const { token } = await engine.createSession({ userId: 'usr_tamper' });
    const parts = token.split('.');
    // Tamper with the sessionId or signature
    const tamperedToken = `${parts[0]}evil.${parts[1]}`;

    await assert.rejects(
      async () => {
        await engine.authenticateToken(tamperedToken);
      },
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError);
        return true;
      }
    );
  });

  it('creates and validates anonymous guest sessions', async () => {
    const engine = new EntitlementsEngine();

    const { session, token } = await engine.createAnonymousSession('198.51.100.12', 'Safari');
    assert.equal(session.role, 'anonymous');
    assert.equal(session.tier, 'free');
    assert.ok(session.metadata?.['isAnonymous']);

    const validated = await engine.authenticateToken(token);
    assert.equal(validated.role, 'anonymous');
  });

  it('enforces RBAC role hierarchy and granular permissions', () => {
    const engine = new EntitlementsEngine();

    // Hierarchy checks
    assert.ok(isRoleAtLeast('admin', 'admin'));
    assert.ok(isRoleAtLeast('admin', 'pro'));
    assert.ok(isRoleAtLeast('admin', 'free'));
    assert.ok(isRoleAtLeast('admin', 'anonymous'));

    assert.ok(!isRoleAtLeast('free', 'pro'));
    assert.ok(!isRoleAtLeast('free', 'admin'));
    assert.ok(isRoleAtLeast('free', 'anonymous'));

    // Free role permissions
    assert.ok(engine.checkPermission('free', 'jobs:create:video'));
    assert.ok(engine.checkPermission('free', 'jobs:create:playlist'));
    assert.ok(engine.checkPermission('free', 'jobs:read'));
    assert.ok(engine.checkPermission('free', 'quota:read'));
    assert.ok(!engine.checkPermission('free', 'admin:metrics'));
    assert.ok(!engine.checkPermission('free', 'admin:users:manage'));

    // Admin role permissions
    assert.ok(engine.checkPermission('admin', 'admin:metrics'));
    assert.ok(engine.checkPermission('admin', 'admin:override_quota'));
    assert.ok(engine.checkPermission('admin', 'admin:users:manage'));
    assert.ok(engine.checkPermission('admin', 'jobs:create:video'));

    // requirePermission assertion
    assert.throws(
      () => {
        engine.requirePermission('free', 'admin:metrics');
      },
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, 'FORBIDDEN');
        assert.equal(err.requiredPermission, 'admin:metrics');
        return true;
      }
    );
  });

  it('revokes sessions cleanly', async () => {
    const engine = new EntitlementsEngine();
    const { session, token } = await engine.createSession({ userId: 'usr_revoke' });

    // Valid
    await engine.authenticateToken(token);

    // Revoke
    const revoked = await engine.revokeSession(session.sessionId);
    assert.equal(revoked, true);

    // Now authentication fails
    await assert.rejects(
      async () => {
        await engine.authenticateToken(token);
      },
      UnauthorizedError
    );
  });
});
