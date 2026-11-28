const SKILL_STORAGE_SLOT = 'muxaro_voyager_skills_v1';

export interface LearnedSkillRecipe {
  id: string;
  intentSummary: string;
  domain: 'pdf' | 'media' | 'python' | 'research' | 'general';
  keywords: string[];
  toolSequence: Array<{ toolName: string; argsTemplate: Record<string, unknown> }>;
  pythonSnippet?: string;
  verifiedPassCount: number;
  failCount: number;
  consecutiveFails: number;
  active: boolean;
  createdAt: number;
  lastUsedAt: number;
}

function readAllSkills(): LearnedSkillRecipe[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SKILL_STORAGE_SLOT);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAllSkills(list: LearnedSkillRecipe[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SKILL_STORAGE_SLOT, JSON.stringify(list.slice(0, 50)));
  } catch {}
}

export function listLearnedSkills(): LearnedSkillRecipe[] {
  return readAllSkills().sort((a, b) => b.verifiedPassCount - a.verifiedPassCount || b.lastUsedAt - a.lastUsedAt);
}

export function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3)
    )
  ).slice(0, 16);
}

/**
 * Voyager Skill Compiler: saves verified multi-step trajectories only when
 * deterministic checks passed cleanly (`output > 0` / clean Python exit / user did not cancel).
 */
export function saveVerifiedSkill(params: {
  intentSummary: string;
  domain: LearnedSkillRecipe['domain'];
  toolSequence: LearnedSkillRecipe['toolSequence'];
  pythonSnippet?: string;
}): LearnedSkillRecipe {
  const existing = readAllSkills();
  const cleanIntent = params.intentSummary.trim().slice(0, 140);
  const kws = extractKeywords(cleanIntent);
  const duplicate = existing.find(
    (s) =>
      s.domain === params.domain &&
      s.toolSequence.map((t) => t.toolName).join(',') === params.toolSequence.map((t) => t.toolName).join(',') &&
      s.intentSummary.toLowerCase() === cleanIntent.toLowerCase()
  );

  if (duplicate) {
    duplicate.verifiedPassCount += 1;
    duplicate.consecutiveFails = 0;
    duplicate.active = true;
    duplicate.lastUsedAt = Date.now();
    writeAllSkills(existing);
    return duplicate;
  }

  const created: LearnedSkillRecipe = {
    id: `skl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    intentSummary: cleanIntent,
    domain: params.domain,
    keywords: kws,
    toolSequence: params.toolSequence,
    pythonSnippet: params.pythonSnippet?.slice(0, 4000),
    verifiedPassCount: 1,
    failCount: 0,
    consecutiveFails: 0,
    active: true,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
  writeAllSkills([created, ...existing]);
  return created;
}

export function searchRelevantSkills(query: string, topK = 3): LearnedSkillRecipe[] {
  const qTokens = new Set(extractKeywords(query));
  if (!qTokens.size) return [];
  const candidates = readAllSkills().filter((s) => s.active);
  return candidates
    .map((s) => {
      let overlap = 0;
      for (const kw of s.keywords) {
        if (qTokens.has(kw)) overlap += 1;
      }
      const reliability = (s.verifiedPassCount + 1) / (s.verifiedPassCount + s.failCount + 2);
      return { skill: s, score: overlap * reliability };
    })
    .filter((x) => x.score >= 1.0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => x.skill);
}

/**
 * Anti-poisoning outcome feedback: auto-demotes skills if they fail twice consecutively.
 */
export function recordSkillOutcome(skillId: string, passed: boolean): void {
  const all = readAllSkills();
  const next = all.map((s) => {
    if (s.id !== skillId) return s;
    if (passed) {
      return {
        ...s,
        verifiedPassCount: s.verifiedPassCount + 1,
        consecutiveFails: 0,
        lastUsedAt: Date.now(),
      };
    }
    const consecutiveFails = s.consecutiveFails + 1;
    return {
      ...s,
      failCount: s.failCount + 1,
      consecutiveFails,
      active: consecutiveFails < 2,
      lastUsedAt: Date.now(),
    };
  });
  writeAllSkills(next);
}

export function deleteLearnedSkill(skillId: string): void {
  writeAllSkills(readAllSkills().filter((s) => s.id !== skillId));
}

export function clearAllLearnedSkills(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SKILL_STORAGE_SLOT);
  } catch {}
}
