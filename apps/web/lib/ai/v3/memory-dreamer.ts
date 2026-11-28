const MEMORY_STORAGE_KEY = 'muxaro_dreaming_memory_v1';
const MAX_MEMORY_RULES = 30;
const DEFAULT_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export interface EpisodicMemoryRule {
  id: string;
  ruleText: string;
  category: 'preference' | 'correction' | 'project_fact';
  confidence: number;
  sourceSessionId?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  enabled: boolean;
}

function readAllRules(): EpisodicMemoryRule[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return [];
    const now = Date.now();
    const list: EpisodicMemoryRule[] = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((r) => !r.expiresAt || r.expiresAt > now) : [];
  } catch {
    return [];
  }
}

function writeAllRules(list: EpisodicMemoryRule[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_MEMORY_RULES)));
  } catch {}
}

export function listMemoryRules(): EpisodicMemoryRule[] {
  return readAllRules().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function addOrUpdateMemoryRule(params: {
  ruleText: string;
  category?: EpisodicMemoryRule['category'];
  confidence?: number;
  sourceSessionId?: string;
}): EpisodicMemoryRule {
  const clean = params.ruleText.trim().slice(0, 180);
  const all = readAllRules();
  const now = Date.now();
  const category = params.category || 'preference';

  // Conflict resolution: newer explicit preference/correction supersedes near-identical topic rule
  const words = new Set(clean.toLowerCase().split(/\W+/).filter((w) => w.length >= 4));
  const filtered = all.filter((existing) => {
    if (existing.ruleText.toLowerCase() === clean.toLowerCase()) return false;
    const exWords = new Set(existing.ruleText.toLowerCase().split(/\W+/).filter((w) => w.length >= 4));
    let inter = 0;
    for (const w of words) if (exWords.has(w)) inter += 1;
    const jaccard = words.size + exWords.size > 0 ? inter / (words.size + exWords.size - inter) : 0;
    return jaccard < 0.68;
  });

  const item: EpisodicMemoryRule = {
    id: `mem-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ruleText: clean,
    category,
    confidence: params.confidence ?? (category === 'correction' ? 0.95 : 0.8),
    sourceSessionId: params.sourceSessionId,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
    enabled: true,
  };

  writeAllRules([item, ...filtered]);
  return item;
}

export function toggleMemoryRule(id: string): void {
  const next = readAllRules().map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
  writeAllRules(next);
}

export function deleteMemoryRule(id: string): void {
  writeAllRules(readAllRules().filter((r) => r.id !== id));
}

export function clearAllMemoryRules(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(MEMORY_STORAGE_KEY);
  } catch {}
}

export function buildMemoryContextBlock(): string {
  const active = listMemoryRules().filter((r) => r.enabled && r.confidence >= 0.6).slice(0, 8);
  if (!active.length) return '';
  return [
    '<user_preferences_memory>',
    ...active.map((r) => `- [${r.category}] ${r.ruleText}`),
    '</user_preferences_memory>',
  ].join('\n');
}

/**
 * Deterministic lightweight session-end "Dreaming" extractor catching explicit
 * user corrections ("always...", "from now on...", "never...", "prefer...").
 */
export function extractExplicitPreferencesFromTurn(userText: string, sessionId?: string): EpisodicMemoryRule[] {
  const added: EpisodicMemoryRule[] = [];
  const lower = userText.toLowerCase();
  if (/\b(always|from now on|prefer|make sure you always|remember that i)\b/i.test(lower) && userText.length <= 220) {
    added.push(
      addOrUpdateMemoryRule({
        ruleText: userText.trim(),
        category: /\b(no|instead|don't|stop)\b/i.test(lower) ? 'correction' : 'preference',
        confidence: 0.92,
        sourceSessionId: sessionId,
      })
    );
  }
  return added;
}
