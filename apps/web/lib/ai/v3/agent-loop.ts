import type { ChatToolCall, ChatToolDef, NormalizedChatMessage } from '../server/provider-adapters.ts';
import { AgentEventStream } from './event-stream.ts';

export interface ReActTurnResponse {
  text: string;
  reasoning?: string;
  toolCalls?: ChatToolCall[];
  engineLabel?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ReActToolOutcome {
  ok: boolean;
  observation: string;
  taintSource: 'trusted_user' | 'untrusted_doc' | 'untrusted_web' | 'untrusted_mcp';
  requiresApprovalReason?: string;
}

export interface ReActLoopResult {
  finalText: string;
  reasoningSteps: string[];
  events: ReturnType<AgentEventStream['getAll']>;
  tainted: boolean;
  haltedForApproval?: {
    toolName: string;
    args: Record<string, unknown>;
    reason: string;
  };
  turnsUsed: number;
  engineLabel?: string;
}

/**
 * Bounded Plan-Execute-Observe-Verify ReAct kernel cleanly decoupled from transport.
 * Works identically across WebGPU, Desktop Ollama/LM Studio, Cloud BYOK SSE, and deterministic tests.
 */
export async function runBoundedReActLoop(params: {
  userInput: string;
  fileNames?: string[];
  systemPrompt: string;
  tools: ChatToolDef[];
  priorMessages?: NormalizedChatMessage[];
  maxTurns?: number;
  maxConsecutiveErrors?: number;
  modelTurn: (args: {
    systemPrompt: string;
    messages: NormalizedChatMessage[];
    tools: ChatToolDef[];
    onToken?: (partial: string) => void;
  }) => Promise<ReActTurnResponse>;
  executeTool: (
    toolName: string,
    args: Record<string, unknown>,
    stream: AgentEventStream
  ) => Promise<ReActToolOutcome>;
  checkApprovalRequired?: (
    toolName: string,
    args: Record<string, unknown>,
    contextTainted: boolean
  ) => string | null;
  onToken?: (partialText: string) => void;
  onStepTrace?: (label: string) => void;
  signal?: AbortSignal;
}): Promise<ReActLoopResult> {
  const maxTurns = Math.min(16, Math.max(1, params.maxTurns || 8));
  const maxErrs = params.maxConsecutiveErrors || 3;
  const stream = new AgentEventStream();

  // Seed prior concise turn history BEFORE appending current turn to keep prompt prefix cache-friendly
  const prior = (params.priorMessages || []).slice(-8);
  stream.append({
    kind: 'user_turn',
    text: params.userInput,
    fileNames: params.fileNames,
  });

  const reasoningSteps: string[] = [];
  let consecutiveErrors = 0;
  let lastEngineLabel: string | undefined;
  let finalText = '';

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    if (params.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const activeMessages: NormalizedChatMessage[] = [...prior, ...stream.toChatMessages()];
    const modelRes = await params.modelTurn({
      systemPrompt: params.systemPrompt,
      messages: activeMessages,
      tools: params.tools,
      onToken: params.onToken,
    });

    if (modelRes.engineLabel) lastEngineLabel = modelRes.engineLabel;
    if (modelRes.reasoning) reasoningSteps.push(modelRes.reasoning);

    const calls = modelRes.toolCalls || [];
    if (calls.length === 0) {
      finalText = modelRes.text.trim();
      stream.append({ kind: 'assistant_final', text: finalText });
      return {
        finalText,
        reasoningSteps,
        events: stream.getAll(),
        tainted: stream.tainted,
        turnsUsed: turn,
        engineLabel: lastEngineLabel,
      };
    }

    for (const call of calls) {
      const approvalReason = params.checkApprovalRequired?.(
        call.name,
        call.arguments || {},
        stream.tainted
      );
      if (approvalReason) {
        stream.append({ kind: 'hitl_request', toolName: call.name, reason: approvalReason });
        return {
          finalText:
            modelRes.text.trim() ||
            `Approval required before running **${call.name}**: ${approvalReason}`,
          reasoningSteps,
          events: stream.getAll(),
          tainted: stream.tainted,
          haltedForApproval: {
            toolName: call.name,
            args: call.arguments || {},
            reason: approvalReason,
          },
          turnsUsed: turn,
          engineLabel: lastEngineLabel,
        };
      }

      stream.append({ kind: 'tool_call', call });
      params.onStepTrace?.(`Running ${call.name}…`);

      const outcome = await params.executeTool(call.name, call.arguments || {}, stream);
      stream.append({
        kind: 'tool_result',
        callId: call.id,
        toolName: call.name,
        ok: outcome.ok,
        summary: outcome.observation,
        taintSource: outcome.taintSource,
      });

      if (!outcome.ok) {
        consecutiveErrors += 1;
        params.onStepTrace?.(`${call.name} hit an error — adjusting…`);
        if (consecutiveErrors >= maxErrs) {
          stream.append({
            kind: 'verification',
            ok: false,
            checkName: 'error_budget',
            detail: `Stopped after ${consecutiveErrors} consecutive tool errors.`,
          });
          return {
            finalText:
              `Stopped after ${consecutiveErrors} tool failures while trying **${call.name}**:\n\n` +
              `${outcome.observation}`,
            reasoningSteps,
            events: stream.getAll(),
            tainted: stream.tainted,
            turnsUsed: turn,
            engineLabel: lastEngineLabel,
          };
        }
      } else {
        consecutiveErrors = 0;
        stream.append({
          kind: 'verification',
          ok: true,
          checkName: call.name,
          detail: 'Tool executed cleanly.',
        });
      }
    }
  }

  return {
    finalText:
      finalText ||
      'Reached step budget cleanly before final summary. Expand Trace Inspector to inspect all verified tool outputs.',
    reasoningSteps,
    events: stream.getAll(),
    tainted: stream.tainted,
    turnsUsed: maxTurns,
    engineLabel: lastEngineLabel,
  };
}
