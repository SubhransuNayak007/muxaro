/**
 * Download Token Signer & Verification Test Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signDownloadToken,
  verifyDownloadToken,
  type SignedDownloadTokenPayload,
  MIN_SECRET_LENGTH
} from '../src/token-signer.ts';

const TEST_SECRET = 'super-secret-download-key-32chars!';

test('Token Signer - Generates valid HMAC-SHA256 token and verifies payload', () => {
  const token = signDownloadToken(
    {
      jobId: 'job_12345',
      artifactId: 'art_67890',
      filename: 'sample_video.mp4',
      userId: 'user_abcdef',
      ttlSeconds: 300
    },
    TEST_SECRET
  );

  assert.ok(typeof token === 'string');
  assert.ok(token.includes('.'));
  assert.equal(token.split('.').length, 2);

  const payload = verifyDownloadToken(token, TEST_SECRET);
  assert.equal(payload.jobId, 'job_12345');
  assert.equal(payload.artifactId, 'art_67890');
  assert.equal(payload.filename, 'sample_video.mp4');
  assert.equal(payload.userId, 'user_abcdef');
  assert.ok(payload.expiresAt > Date.now());
});

test('Token Signer - Enforces minimum secret length', () => {
  assert.throws(
    () => {
      signDownloadToken(
        {
          jobId: 'job_1',
          artifactId: 'art_1',
          filename: 'video.mp4',
          userId: 'user_1'
        },
        'short-key'
      );
    },
    /at least 16 characters/
  );
});

test('Token Signer - Rejects tampered signature', () => {
  const token = signDownloadToken(
    {
      jobId: 'job_12345',
      artifactId: 'art_67890',
      filename: 'sample_video.mp4',
      userId: 'user_abcdef'
    },
    TEST_SECRET
  );

  const [payloadB64, signature] = token.split('.');
  // Flip last character of signature
  const tamperedSig = signature.slice(0, -1) + (signature.slice(-1) === 'a' ? 'b' : 'a');
  const tamperedToken = `${payloadB64}.${tamperedSig}`;

  assert.throws(
    () => verifyDownloadToken(tamperedToken, TEST_SECRET),
    /invalid signature or token was tampered with/
  );
});

test('Token Signer - Rejects tampered payload', () => {
  const token = signDownloadToken(
    {
      jobId: 'job_12345',
      artifactId: 'art_67890',
      filename: 'sample_video.mp4',
      userId: 'user_victim'
    },
    TEST_SECRET
  );

  const [payloadB64, signature] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  // Attacker attempts IDOR by switching userId
  decoded.userId = 'user_attacker';
  const forgedPayloadB64 = Buffer.from(JSON.stringify(decoded)).toString('base64url');
  const forgedToken = `${forgedPayloadB64}.${signature}`;

  assert.throws(
    () => verifyDownloadToken(forgedToken, TEST_SECRET),
    /invalid signature or token was tampered with/
  );
});

test('Token Signer - Rejects expired tokens', () => {
  // Sign a token that expired 10 seconds ago
  const expiredToken = signDownloadToken(
    {
      jobId: 'job_12345',
      artifactId: 'art_67890',
      filename: 'sample_video.mp4',
      userId: 'user_abcdef',
      expiresAt: Date.now() - 10000
    },
    TEST_SECRET
  );

  assert.throws(
    () => verifyDownloadToken(expiredToken, TEST_SECRET),
    /token has expired/
  );
});

test('Token Signer - Rejects prototype pollution payloads', async () => {
  const jsonWithProto = JSON.stringify({
    jobId: 'job_123',
    artifactId: 'art_123',
    filename: 'video.mp4',
    userId: 'user_1',
    expiresAt: Date.now() + 60000
  }).replace('{', '{"__proto__":{"polluted":true},');

  const payloadB64 = Buffer.from(jsonWithProto, 'utf8').toString('base64url');
  const crypto = await import('node:crypto');
  const signature = crypto
    .createHmac('sha256', TEST_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const token = `${payloadB64}.${signature}`;

  assert.throws(
    () => verifyDownloadToken(token, TEST_SECRET),
    /prototype pollution attempt detected/
  );
});

test('Token Signer - Sanitizes path traversal in filenames', () => {
  const token = signDownloadToken(
    {
      jobId: 'job_12345',
      artifactId: 'art_67890',
      filename: '../../../../etc/passwd',
      userId: 'user_abcdef'
    },
    TEST_SECRET
  );

  const payload = verifyDownloadToken(token, TEST_SECRET);
  assert.equal(payload.filename, 'passwd');
  assert.ok(!payload.filename.includes('..'));
});
