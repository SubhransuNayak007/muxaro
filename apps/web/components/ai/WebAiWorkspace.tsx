'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Activity,
  MessageSquarePlus,
  PanelLeft,
  Settings,
  Trash2,
} from 'lucide-react';
import {
  deleteChatSession,
  deriveChatTitle,
  loadChatSessions,
  upsertChatSession,
  type ChatSessionRecord,
  type SavedAttachmentRef,
  type StoredChatMessage,
} from '@/lib/ai';
import { useOpenedArtifact } from '@/lib/opened-artifact';

const MuxaroCopilotPanel = dynamic(() => import('@/components/ai/MuxaroCopilotPanel'), {
  ssr: false,
});
const TraceInspectorDrawer = dynamic(() => import('@/components/ai/TraceInspectorDrawer'), {
  ssr: false,
});

export default function WebAiWorkspace() {
  const { artifact } = useOpenedArtifact();
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => `sess-${Date.now()}`);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
  const [resetSignal, setResetSignal] = useState<number>(0);
  const [initialPrompt, setInitialPrompt] = useState<string>('');

  useEffect(() => {
    const loaded = loadChatSessions();
    setSessions(loaded);
    if (loaded[0]) {
      setActiveSessionId(loaded[0].id);
    }
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const q = (sp.get('prompt') || '').trim();
      if (q) setInitialPrompt(q);
      if (window.innerWidth >= 1024) setSidebarOpen(true);
    }
  }, []);

  const currentSession = sessions.find((s) => s.id === activeSessionId);

  const handleNewChat = () => {
    const freshId = `sess-${Date.now()}`;
    setActiveSessionId(freshId);
    setResetSignal((n) => n + 1);
  };

  const handleSessionChange = (msgs: StoredChatMessage[], activeRefs: SavedAttachmentRef[]) => {
    if (!msgs.length) return;
    const firstUserText = msgs.find((m) => m.role === 'user')?.text || '';
    const nextRec: ChatSessionRecord = {
      id: activeSessionId,
      title: deriveChatTitle(firstUserText, activeRefs),
      pinned: currentSession?.pinned || false,
      createdAt: currentSession?.createdAt || Date.now(),
      updatedAt: Date.now(),
      activeFiles: activeRefs,
      messages: msgs,
    };
    const nextList = upsertChatSession(nextRec);
    setSessions(nextList);
  };

  return (
    <div className="w-full h-[calc(100dvh-57px)] flex bg-base overflow-hidden">
      {/* Left Collapsible Sessions Rail */}
      {sidebarOpen && (
        <aside
          aria-label="Conversation history"
          className="w-64 border-r border-line bg-surface flex flex-col shrink-0 h-full"
        >
          <div className="p-3 border-b border-line flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleNewChat}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-brand text-brand-fg text-xs font-semibold hover:bg-brand-hover transition-colors"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New chat</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 ? (
              <p className="text-[11px] text-content-secondary px-2 py-4">
                Your local conversations appear here.
              </p>
            ) : (
              sessions.map((sess) => (
                <div
                  key={sess.id}
                  className={`group flex items-center justify-between gap-1 rounded-xl px-2.5 py-2 text-xs transition-colors ${
                    sess.id === activeSessionId
                      ? 'bg-surface-elevated text-content font-semibold border border-line'
                      : 'text-content-secondary hover:bg-surface-elevated hover:text-content'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveSessionId(sess.id)}
                    className="flex-1 min-w-0 text-left truncate"
                  >
                    {sess.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const { updated } = deleteChatSession(sess.id);
                      setSessions(updated);
                      if (sess.id === activeSessionId) handleNewChat();
                    }}
                    aria-label={`Delete ${sess.title}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-content-tertiary hover:text-error shrink-0"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t border-line flex items-center justify-between text-xs">
            <Link
              href="/settings?tab=ai"
              className="inline-flex items-center gap-1.5 text-content-secondary hover:text-content font-medium"
            >
              <Settings className="w-3.5 h-3.5" aria-hidden="true" />
              <span>AI &amp; Memory</span>
            </Link>
          </div>
        </aside>
      )}

      {/* Center Main ChatGPT/Gemini Studio Column */}
      <main className="flex-1 min-w-0 h-full flex flex-col">
        <div className="px-4 py-2 border-b border-line bg-surface flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle sessions sidebar"
              className="p-1.5 rounded-lg border border-line bg-surface-elevated text-content-secondary hover:text-content"
            >
              <PanelLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <h1 className="text-sm font-semibold text-content">MUXARO AI Studio</h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setInspectorOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
                inspectorOpen
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-line bg-surface-elevated text-content-secondary hover:text-content'
              }`}
            >
              <Activity className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Traces</span>
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-3 sm:px-6 pt-3 pb-3">
          <MuxaroCopilotPanel
            variant="embedded"
            open
            activeFile={artifact?.file || null}
            sessionId={activeSessionId}
            initialMessages={currentSession?.messages}
            initialPrompt={initialPrompt}
            onMessagesChange={handleSessionChange}
            resetSignal={resetSignal}
          />
        </div>
      </main>

      <TraceInspectorDrawer open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
    </div>
  );
}
