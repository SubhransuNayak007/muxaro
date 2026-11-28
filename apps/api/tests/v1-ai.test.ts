import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_ENABLED = 'false';

import { buildApp } from '../src/app.js';

test('Fastify /api/v1/ai routes enforce BYOK/SSRF security and research job persistence', async () => {
  const app = await buildApp();

  // 1. /ai/chat without key returns honest 401
  const chatRes = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/chat',
    payload: {
      provider: 'gemini',
      messages: [{ role: 'user', content: 'hello' }],
    },
  });
  assert.equal(chatRes.statusCode, 401);
  const chatBody = chatRes.json();
  assert.equal(chatBody.code, 'BYOK_OR_LOCAL_REQUIRED');

  // 2. /ai/fetch blocks SSRF loopback & AWS metadata
  for (const badUrl of [
    'http://127.0.0.1:4000/api/v1/health',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:3000/',
  ]) {
    const fetchRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/fetch',
      payload: { url: badUrl },
    });
    assert.equal(fetchRes.statusCode, 400);
  }

  // 3. /ai/mcp blocks private hosts cleanly
  const mcpRes = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/mcp',
    payload: {
      serverUrl: 'http://10.0.0.1:8080/mcp',
      method: 'tools/list',
    },
  });
  assert.equal(mcpRes.statusCode, 400);

  // 4. Background /ai/research-jobs validates & persists row in SQLite
  const jobRes = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/research-jobs',
    payload: { query: 'hybrid rag rrf benchmark' },
  });
  assert.equal(jobRes.statusCode, 202);
  const jobJson = jobRes.json();
  assert.ok(jobJson.id);

  const pollRes = await app.inject({
    method: 'GET',
    url: `/api/v1/ai/research-jobs/${jobJson.id}`,
  });
  assert.equal(pollRes.statusCode, 200);
  const pollJson = pollRes.json();
  assert.equal(pollJson.ok, true);
  assert.equal(pollJson.job.query, 'hybrid rag rrf benchmark');

  await app.close();
});
