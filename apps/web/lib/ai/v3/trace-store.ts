export interface AgentTraceStep {
  toolName: string;
  ok: boolean;
  summary: string;
  ts: number;
}

export interface AgentTraceRecord {
  id: string;
  createdAt: number;
  userQueryRedacted: string;
  engineLabel: string;
  tainted: boolean;
  turnsUsed: number;
  elapsedMs: number;
  steps: AgentTraceStep[];
  citationsCount: number;
  webSourcesCount: number;
  verificationPassed: boolean;
  rating: 'up' | 'down' | null;
  note?: string;
}

const TRACE_STORAGE_SLOT = 'muxaro_ai_traces_v1';
const MAX_TRACES = 60;

function redactSecretsForTrace(raw: string): string {
  return raw
    .replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\bgsk_[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
    .slice(0, 320);
}

export function listTraces(): AgentTraceRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TRACE_STORAGE_SLOT);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTraceRecord(rec: Omit<AgentTraceRecord, 'id' | 'createdAt' | 'rating'>): AgentTraceRecord {
  const item: AgentTraceRecord = {
    ...rec,
    userQueryRedacted: redactSecretsForTrace(rec.userQueryRedacted),
    id: `trc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    rating: null,
  };
  if (typeof window !== 'undefined') {
    try {
      const next = [item, ...listTraces()].slice(0, MAX_TRACES);
      localStorage.setItem(TRACE_STORAGE_SLOT, JSON.stringify(next));
    } catch {}
  }
  return item;
}

export function rateTrace(traceId: string, rating: 'up' | 'down', note?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const next = listTraces().map((t) =>
      t.id === traceId
        ? { ...t, rating, ...(note !== undefined ? { note: redactSecretsForTrace(note) } : {}) }
        : t
    );
    localStorage.setItem(TRACE_STORAGE_SLOT, JSON.stringify(next));
  } catch {}
}

export function clearAllTraces(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(TRACE_STORAGE_SLOT);
  } catch {}
}

export function exportTracesAsJsonl(): string {
  return listTraces()
    .map((t) => JSON.stringify(t))
    .join('\n');
}
