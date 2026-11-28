import type { NormalizedChatMessage, ChatToolCall } from '../server/provider-adapters.ts';

export type TaintSourceKind = 'trusted_user' | 'untrusted_doc' | 'untrusted_web' | 'untrusted_mcp';

export type AgentEvent =
  | { id: string; ts: number; kind: 'user_turn'; text: string; fileNames?: string[] }
  | { id: string; ts: number; kind: 'plan_update'; items: Array<{ label: string; done: boolean }> }
  | { id: string; ts: number; kind: 'thought'; text: string }
  | { id: string; ts: number; kind: 'tool_call'; call: ChatToolCall }
  | {
      id: string;
      ts: number;
      kind: 'tool_result';
      callId: string;
      toolName: string;
      ok: boolean;
      summary: string;
      taintSource: TaintSourceKind;
    }
  | { id: string; ts: number; kind: 'verification'; ok: boolean; checkName: string; detail: string }
  | { id: string; ts: number; kind: 'compaction'; droppedEvents: number; summary: string }
  | { id: string; ts: number; kind: 'hitl_request'; toolName: string; reason: string }
  | { id: string; ts: number; kind: 'assistant_final'; text: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never;
export type NewAgentEvent = DistributiveOmit<AgentEvent, 'id' | 'ts'>;

export class AgentEventStream {
  private events: AgentEvent[] = [];
  public tainted = false;
  public taintSources = new Set<TaintSourceKind>();

  constructor(initial: AgentEvent[] = []) {
    this.events = [...initial];
  }

  public append(evt: NewAgentEvent): AgentEvent {
    const full = {
      ...evt,
      id: `evt-${this.events.length + 1}-${Date.now().toString(36)}`,
      ts: Date.now(),
    } as AgentEvent;
    this.events.push(full);
    if (full.kind === 'tool_result' && full.taintSource !== 'trusted_user') {
      this.tainted = true;
      this.taintSources.add(full.taintSource);
    }
    return full;
  }

  public getAll(): AgentEvent[] {
    return this.events;
  }

  /**
   * Serializes append-only events cleanly while preserving early KV prefixes
   * and appending an active plan checklist at the context tail (Manus pattern).
   */
  public toChatMessages(maxCharsBudget = 44_000): NormalizedChatMessage[] {
    const out: NormalizedChatMessage[] = [];
    let latestPlan: Array<{ label: string; done: boolean }> | null = null;
    let totalChars = 0;

    for (const ev of this.events) {
      if (ev.kind === 'plan_update') {
        latestPlan = ev.items;
        continue;
      }
      if (ev.kind === 'user_turn') {
        const filesNote = ev.fileNames?.length
          ? `\n[Attached workspace files: ${ev.fileNames.join(', ')}]`
          : '';
        const content = `${ev.text}${filesNote}`;
        totalChars += content.length;
        out.push({ role: 'user', content });
      } else if (ev.kind === 'thought') {
        // Group preceding thought with next message or compact
      } else if (ev.kind === 'tool_call') {
        const msg: NormalizedChatMessage = {
          role: 'assistant',
          content: '',
          toolCalls: [ev.call],
        };
        totalChars += JSON.stringify(ev.call).length;
        out.push(msg);
      } else if (ev.kind === 'tool_result') {
        const trimmedSummary =
          ev.summary.length > 6000
            ? `${ev.summary.slice(0, 5600)}\n...[truncated ${ev.summary.length - 5600} chars for context health]`
            : ev.summary;
        totalChars += trimmedSummary.length;
        out.push({
          role: 'tool',
          toolCallId: ev.callId,
          toolName: ev.toolName,
          content: trimmedSummary,
        });
      } else if (ev.kind === 'assistant_final') {
        totalChars += ev.text.length;
        out.push({ role: 'assistant', content: ev.text });
      }
    }

    // Automatic Context Compaction: trim middle verbose tool outputs while preserving user goal + latest 6 turns
    if (totalChars > maxCharsBudget && out.length > 8) {
      const head = out.slice(0, 2);
      const tail = out.slice(-6);
      const middleCount = out.length - 8;
      const compactedNote: NormalizedChatMessage = {
        role: 'assistant',
        content: `[Context Compaction: compressed ${middleCount} earlier intermediate step observations to keep working context crisp.]`,
      };
      return [
        ...head,
        compactedNote,
        ...tail,
        ...(latestPlan ? [buildPlanTailMessage(latestPlan)] : []),
      ];
    }

    if (latestPlan && out.length > 0 && out[out.length - 1].role === 'tool') {
      out.push(buildPlanTailMessage(latestPlan));
    }

    return out;
  }
}

function buildPlanTailMessage(items: Array<{ label: string; done: boolean }>): NormalizedChatMessage {
  const checklist = items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.label}`).join('\n');
  return {
    role: 'user',
    content: `<active_plan_checklist>\n${checklist}\n</active_plan_checklist>`,
  };
}
