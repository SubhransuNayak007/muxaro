import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentEventStream } from '../v3/event-stream.ts';
import { runBoundedReActLoop } from '../v3/agent-loop.ts';
import { selectActiveToolDefinitions } from '../v3/tool-dispatcher.ts';
import { computeReciprocalRankFusion } from '../v3/rrf.ts';
import { isPrivateOrReservedIp, assertSafePublicUrl } from '../server/ssrf-guard.ts';
import {
  sanitizeUpstreamError,
  parseOpenAiSseDataLine,
  parseGeminiSseDataLine,
} from '../server/provider-adapters.ts';

test('SSRF guard blocks loopback, private CIDRs, link-local metadata, and bad schemes', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.1', '192.168.0.10', '169.254.169.254', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateOrReservedIp(ip), true);
  }
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  await assert.rejects(() => assertSafePublicUrl('http://127.0.0.1:4000/secret'));
  await assert.rejects(() => assertSafePublicUrl('http://169.254.169.254/latest/meta-data/'));
  await assert.rejects(() => assertSafePublicUrl('file:///etc/passwd'));
  await assert.rejects(() => assertSafePublicUrl('https://user:pass@example.com/'));
});

test('Provider adapters parse OpenAI & Gemini SSE tool deltas and scrub leaked keys', () => {
  const err = sanitizeUpstreamError('Auth failed with key sk-proj-secret1234567890 and AIzaSyA123456789012345', 'sk-proj-secret1234567890');
  assert.equal(err.includes('secret1234567890'), false);
  assert.equal(err.includes('AIzaSyA123456789012345'), false);

  const oai = parseOpenAiSseDataLine(
    JSON.stringify({
      choices: [{ delta: { content: 'hi', tool_calls: [{ index: 0, id: 'c1', function: { name: 'python_exec', arguments: '{"code":' } }] } }],
    })
  );
  assert.equal(oai.token, 'hi');
  assert.equal(oai.toolCallDeltas?.[0].name, 'python_exec');

  const gem = parseGeminiSseDataLine(
    JSON.stringify({
      candidates: [{ content: { parts: [{ functionCall: { name: 'web_search', args: { query: 'test' } } }] } }],
    })
  );
  assert.equal(gem.toolCalls?.[0].name, 'web_search');
});

test('ReAct loop completes multi-step plan, recovers from Reflexion error, and enforces Lethal Trifecta HITL', async () => {
  // 1. Multi-step + error recovery
  let callIndex = 0;
  const res = await runBoundedReActLoop({
    userInput: 'Analyze csv with python',
    systemPrompt: 'sys',
    tools: [],
    modelTurn: async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return { text: '', toolCalls: [{ id: 't1', name: 'python_exec', arguments: { code: 'bad()' } }] };
      }
      if (callIndex === 2) {
        return { text: '', toolCalls: [{ id: 't2', name: 'python_exec', arguments: { code: 'print(42)' } }] };
      }
      return { text: 'The result is 42.' };
    },
    executeTool: async (_name, args) => {
      if (String(args.code).includes('bad')) {
        return { ok: false, observation: 'NameError: bad not defined', taintSource: 'trusted_user' };
      }
      return { ok: true, observation: 'STDOUT: 42', taintSource: 'trusted_user' };
    },
  });
  assert.equal(res.finalText, 'The result is 42.');
  assert.equal(res.turnsUsed, 3);

  // 2. Lethal Trifecta halt when untrusted web/doc data is followed by gated call
  let step = 0;
  const halted = await runBoundedReActLoop({
    userInput: 'Read external page then run mcp',
    systemPrompt: 'sys',
    tools: [],
    modelTurn: async () => {
      step += 1;
      if (step === 1) return { text: '', toolCalls: [{ id: 'w1', name: 'web_fetch', arguments: { url: 'https://example.com' } }] };
      return { text: '', toolCalls: [{ id: 'm1', name: 'mcp_call_tool', arguments: { toolName: 'send' } }] };
    },
    executeTool: async () => ({ ok: true, observation: 'Untrusted content', taintSource: 'untrusted_web' }),
    checkApprovalRequired: (toolName, _args, tainted) =>
      tainted && toolName === 'mcp_call_tool' ? 'Context tainted by external content' : null,
  });
  assert.equal(halted.tainted, true);
  assert.equal(halted.haltedForApproval?.toolName, 'mcp_call_tool');
});

test('Context compaction trims bloated middle steps and Tool RAG bounds schemas <= 9', () => {
  const stream = new AgentEventStream();
  stream.append({ kind: 'user_turn', text: 'Goal' });
  for (let i = 0; i < 8; i += 1) {
    stream.append({ kind: 'tool_call', call: { id: `c${i}`, name: 'web_fetch', arguments: {} } });
    stream.append({
      kind: 'tool_result',
      callId: `c${i}`,
      toolName: 'web_fetch',
      ok: true,
      summary: 'x'.repeat(2500),
      taintSource: 'untrusted_web',
    });
  }
  const serialized = stream.toChatMessages(12_000);
  assert.ok(serialized.some((m) => m.content.includes('Context Compaction')));

  const { tools } = selectActiveToolDefinitions({
    userGoal: 'compress video and ocr pdf and search web',
    hasPdfAttached: true,
    hasMediaAttached: true,
    allowWebTools: true,
    hasConnectedMcp: true,
  });
  assert.ok(tools.length <= 9);

  const fused = computeReciprocalRankFusion([
    { items: [{ id: 'a' }, { id: 'b' }] },
    { items: [{ id: 'b' }, { id: 'c' }] },
  ]);
  assert.equal(fused[0].item.id, 'b');
});
