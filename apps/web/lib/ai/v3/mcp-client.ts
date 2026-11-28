'use client';

import { resolveAiHttpOrigin } from './settings-store.ts';

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  schemaSha256: string;
  suspiciousReason?: string;
}

const POISON_PATTERNS = [
  /ignore\s+(?:all\s+)?previous/i,
  /~\/\.ssh|id_rsa|exfiltrate|\.cursor\/mcp/i,
  /<important>[\s\S]*send/i,
];

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(dig), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function detectPoisonedToolDescription(desc: string): string | undefined {
  if (desc.length > 2000) {
    return 'Tool description exceeds 2000 characters (possible hidden prompt payload).';
  }
  for (const pat of POISON_PATTERNS) {
    if (pat.test(desc)) return 'Suspicious directive found inside MCP tool description.';
  }
  if (/[\u200B-\u200F\u202A-\u202E]/.test(desc)) {
    return 'Invisible Unicode direction/zero-width characters detected inside tool description.';
  }
  return undefined;
}

async function postMcpRpc(
  serverUrl: string,
  method: 'tools/list' | 'tools/call' | 'resources/list' | 'resources/read',
  params: Record<string, unknown> = {},
  authToken?: string
): Promise<any> {
  const origin = resolveAiHttpOrigin();
  const resp = await fetch(`${origin}/api/v1/ai/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'x-muxaro-mcp-auth': authToken } : {}),
    },
    body: JSON.stringify({ serverUrl, method, params }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || `MCP relay returned HTTP ${resp.status}`);
  }
  if (data.rpc?.error) {
    throw new Error(data.rpc.error.message || 'MCP server JSON-RPC error');
  }
  return data.rpc?.result;
}

export async function discoverMcpToolsWithPinning(
  serverUrl: string,
  previousPins: Record<string, string> = {},
  authToken?: string
): Promise<{
  tools: McpToolSchema[];
  updatedPins: Record<string, string>;
  rugPullWarnings: string[];
}> {
  const res = await postMcpRpc(serverUrl, 'tools/list', {}, authToken);
  const rawTools: Array<Record<string, any>> = Array.isArray(res?.tools) ? res.tools : [];
  const tools: McpToolSchema[] = [];
  const updatedPins: Record<string, string> = { ...previousPins };
  const rugPullWarnings: string[] = [];

  for (const t of rawTools.slice(0, 30)) {
    const name = String(t.name || '').trim();
    if (!name) continue;
    const description = String(t.description || '');
    const inputSchema =
      t.inputSchema && typeof t.inputSchema === 'object' ? (t.inputSchema as Record<string, unknown>) : {};
    const canonical = JSON.stringify({ name, description, inputSchema });
    const schemaSha256 = await sha256Hex(canonical);
    if (previousPins[name] && previousPins[name] !== schemaSha256) {
      rugPullWarnings.push(`MCP tool "${name}" changed its schema since first pinned (rug-pull alert).`);
    }
    updatedPins[name] = schemaSha256;
    tools.push({
      name,
      description,
      inputSchema,
      schemaSha256,
      suspiciousReason: detectPoisonedToolDescription(description),
    });
  }

  return { tools, updatedPins, rugPullWarnings };
}

export async function invokePinnedMcpTool(params: {
  serverUrl: string;
  toolName: string;
  args: Record<string, unknown>;
  expectedSha256?: string;
  authToken?: string;
}): Promise<string> {
  if (params.expectedSha256) {
    const check = await discoverMcpToolsWithPinning(
      params.serverUrl,
      { [params.toolName]: params.expectedSha256 },
      params.authToken
    );
    if (check.rugPullWarnings.length > 0) {
      throw new Error(check.rugPullWarnings[0]);
    }
  }
  const result = await postMcpRpc(
    params.serverUrl,
    'tools/call',
    { name: params.toolName, arguments: params.args || {} },
    params.authToken
  );
  if (Array.isArray(result?.content)) {
    return result.content
      .map((c: any) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
      .join('\n');
  }
  return JSON.stringify(result || {});
}
