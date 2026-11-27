export interface SavedAttachmentRef {
  id: string;
  name: string;
  sizeBytes: number;
  isPdf: boolean;
  localPath?: string;
}

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sublabel?: string;
  attachments?: SavedAttachmentRef[];
  createdAt: number;
}

export interface ChatSessionRecord {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  activeFiles: SavedAttachmentRef[];
  messages: StoredChatMessage[];
}

export type ChatHistoryBucket = 'Pinned' | 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Older';

const STORAGE_KEY = 'muxaro_chat_sessions_v3';
const MAX_STORED_SESSIONS = 40;

export function deriveChatTitle(firstPrompt: string, files: SavedAttachmentRef[]): string {
  const clean = firstPrompt.replace(/^https?:\/\//i, '').trim();
  if (clean) {
    const words = clean.split(/\s+/).slice(0, 5).join(' ');
    return words.length > 42 ? `${words.slice(0, 39)}…` : words;
  }
  if (files[0]?.name) {
    return files[0].name.replace(/\.[^.]+$/, '').slice(0, 36);
  }
  return 'New conversation';
}

export function loadChatSessions(): ChatSessionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.id === 'string')
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveChatSessions(sessions: ChatSessionRecord[]): ChatSessionRecord[] {
  const sorted = [...sessions]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_SESSIONS);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    } catch {
      // Ignore storage quota full gracefully
    }
  }
  return sorted;
}

export function upsertChatSession(session: ChatSessionRecord): ChatSessionRecord[] {
  const all = loadChatSessions();
  const next = [session, ...all.filter((s) => s.id !== session.id)];
  return saveChatSessions(next);
}

export function deleteChatSession(id: string): { updated: ChatSessionRecord[]; removed?: ChatSessionRecord } {
  const all = loadChatSessions();
  const removed = all.find((s) => s.id === id);
  const updated = saveChatSessions(all.filter((s) => s.id !== id));
  return { updated, removed };
}

export function groupSessionsByDate(
  sessions: ChatSessionRecord[]
): Array<{ group: ChatHistoryBucket; items: ChatSessionRecord[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 86_400_000;

  const buckets: Record<ChatHistoryBucket, ChatSessionRecord[]> = {
    Pinned: [],
    Today: [],
    Yesterday: [],
    'Previous 7 Days': [],
    Older: [],
  };

  for (const s of sessions) {
    if (s.pinned) {
      buckets.Pinned.push(s);
    } else if (s.updatedAt >= startOfToday) {
      buckets.Today.push(s);
    } else if (s.updatedAt >= startOfToday - oneDay) {
      buckets.Yesterday.push(s);
    } else if (s.updatedAt >= startOfToday - 7 * oneDay) {
      buckets['Previous 7 Days'].push(s);
    } else {
      buckets.Older.push(s);
    }
  }

  return (['Pinned', 'Today', 'Yesterday', 'Previous 7 Days', 'Older'] as ChatHistoryBucket[])
    .filter((g) => buckets[g].length > 0)
    .map((group) => ({ group, items: buckets[group] }));
}

export function exportChatAsMarkdown(session: ChatSessionRecord): string {
  const lines = [`# ${session.title}`, ''];
  for (const m of session.messages) {
    lines.push(`**${m.role === 'user' ? 'You' : 'MUXARO'}:**`);
    if (m.attachments?.length) {
      lines.push(`_Files: ${m.attachments.map((a) => a.name).join(', ')}_`);
    }
    lines.push(m.text, '');
  }
  return lines.join('\n');
}
