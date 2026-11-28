'use client';

import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Download,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import {
  clearAllTraces,
  exportTracesAsJsonl,
  listTraces,
  rateTrace,
  type AgentTraceRecord,
} from '@/lib/ai';

export default function TraceInspectorDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [traces, setTraces] = useState<AgentTraceRecord[]>([]);

  const reload = () => setTraces(listTraces());

  useEffect(() => {
    if (open) reload();
  }, [open]);

  if (!open) return null;

  const handleExport = () => {
    const jsonl = exportTracesAsJsonl();
    const blob = new Blob([jsonl || ''], { type: 'application/x-ndjson;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `muxaro-agent-traces-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <aside
      aria-label="Agent Trace & Evaluation Inspector"
      className="w-full lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-line bg-surface flex flex-col h-full shrink-0"
    >
      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold text-content truncate">
            Trace &amp; Eval Inspector ({traces.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleExport}
            disabled={!traces.length}
            title="Export redacted JSONL traces"
            className="p-1.5 rounded-lg border border-line text-content-secondary hover:text-content disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              clearAllTraces();
              reload();
            }}
            disabled={!traces.length}
            title="Clear traces"
            className="p-1.5 rounded-lg border border-line text-content-secondary hover:text-error disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="p-1.5 rounded-lg border border-line text-content-secondary hover:text-content"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
        {traces.length === 0 ? (
          <p className="text-content-secondary text-center py-8 leading-relaxed">
            No traces recorded yet. Run an AI turn to inspect latency, tool steps, verification, and taint safety.
          </p>
        ) : (
          traces.map((tr) => (
            <div key={tr.id} className="p-3 rounded-xl border border-line bg-surface-elevated space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-content line-clamp-2">{tr.userQueryRedacted}</p>
                <span className="text-[10px] font-mono text-content-secondary shrink-0 tabular-nums">
                  {tr.elapsedMs}ms
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-content-secondary">
                <span className="px-2 py-0.5 rounded-full bg-surface border border-line">{tr.engineLabel}</span>
                <span className="px-2 py-0.5 rounded-full bg-surface border border-line">
                  {tr.turnsUsed} turn{tr.turnsUsed === 1 ? '' : 's'}
                </span>
                {tr.verificationPassed ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                    Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="w-3 h-3" aria-hidden="true" />
                    Partial
                  </span>
                )}
                {tr.tainted && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">
                    Taint-guarded
                  </span>
                )}
              </div>

              {tr.steps.length > 0 && (
                <div className="pl-2 border-l border-line space-y-0.5 text-[11px] text-content-secondary">
                  {tr.steps.map((st, idx) => (
                    <div key={idx} className="truncate">
                      <span className="font-mono text-content">{st.toolName}</span>: {st.ok ? 'ok' : 'err'}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-1 border-t border-line/60">
                <span className="text-[10px] text-content-tertiary">
                  {new Date(tr.createdAt).toLocaleTimeString()}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Mark trace good"
                    onClick={() => {
                      rateTrace(tr.id, 'up');
                      reload();
                    }}
                    className={`p-1 rounded-md border ${
                      tr.rating === 'up'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                        : 'border-line text-content-secondary hover:text-content'
                    }`}
                  >
                    <ThumbsUp className="w-3 h-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Mark trace failed"
                    onClick={() => {
                      rateTrace(tr.id, 'down');
                      reload();
                    }}
                    className={`p-1 rounded-md border ${
                      tr.rating === 'down'
                        ? 'border-error/40 bg-error-bg text-error'
                        : 'border-line text-content-secondary hover:text-content'
                    }`}
                  >
                    <ThumbsDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
