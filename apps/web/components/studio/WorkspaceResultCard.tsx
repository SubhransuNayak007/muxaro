'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Edit3,
  RotateCcw,
  Share2,
} from 'lucide-react';
import { formatBytes } from '@/lib/formatters';
import { isNativeAppRuntime } from '@/lib/native-bridge';

export interface ChainTarget {
  href: string;
  label: string;
}

export interface WorkspaceResultCardProps {
  fileName: string;
  sizeBytes: number;
  elapsedMs?: number;
  summary?: string;
  statusLabel?: string;
  warnings?: string[];
  editableName?: boolean;
  onDownload: (finalName: string) => void;
  onShare?: (finalName: string) => void;
  onReset: () => void;
  resetLabel?: string;
  chainHeading?: string;
  chainSublabel?: string;
  chainTargets?: ChainTarget[];
  onChainTo?: (targetHref: string, finalName: string) => void;
  extraContent?: React.ReactNode;
}

/**
 * Shared local/processed output card across PDF, Video, and Audio tools.
 * Supports inline rename, download, Web Share, and zero-reupload tool chaining.
 */
export default function WorkspaceResultCard({
  fileName,
  sizeBytes,
  elapsedMs,
  summary,
  statusLabel = 'Browser Local',
  warnings,
  editableName = true,
  onDownload,
  onShare,
  onReset,
  resetLabel = 'Clear',
  chainHeading = 'Continue in another tool',
  chainSublabel = 'Passes directly in browser memory',
  chainTargets = [],
  onChainTo,
  extraContent,
}: WorkspaceResultCardProps) {
  const [editedName, setEditedName] = useState(fileName);
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    setEditedName(fileName);
    setEditingName(false);
  }, [fileName]);

  const resolvedName = editedName.trim() || fileName;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-6 p-5 sm:p-6 rounded-2xl border border-success/35 bg-surface space-y-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {editableName && editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setEditingName(false);
                    } else if (e.key === 'Escape') {
                      setEditedName(fileName);
                      setEditingName(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg border border-line bg-surface-elevated text-sm font-semibold text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  aria-label="Output filename"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="text-xs font-semibold text-brand hover:text-brand-hover whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded px-1.5 py-1"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base font-semibold text-content break-all">
                  {resolvedName}
                </span>
                {editableName && (
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    aria-label="Rename output file"
                    className="p-1 rounded-md hover:bg-surface-elevated text-content-secondary hover:text-content shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-content-secondary">
              <span className="px-2 py-0.5 rounded-md bg-surface-elevated border border-line font-mono tabular-nums text-[11px] text-content">
                {formatBytes(sizeBytes)}
              </span>
              {typeof elapsedMs === 'number' && (
                <span className="px-2 py-0.5 rounded-md bg-surface-elevated border border-line font-mono tabular-nums text-[11px]">
                  {elapsedMs} ms
                </span>
              )}
              <span className="px-2 py-0.5 rounded-md bg-success-bg border border-success/25 text-success font-mono text-[11px]">
                {statusLabel}
              </span>
              {summary && <span className="text-content-secondary">{summary}</span>}
            </div>

            {warnings && warnings.length > 0 && (
              <ul className="mt-2.5 space-y-1 text-xs text-warning">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onDownload(resolvedName)}
            className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-brand-fg text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Download</span>
          </button>

          {onShare &&
            (isNativeAppRuntime() ||
              (typeof navigator !== 'undefined' && typeof navigator.share === 'function')) && (
            <button
              type="button"
              onClick={() => onShare(resolvedName)}
              className="px-3.5 py-2 rounded-xl border border-line bg-surface-elevated hover:border-line-hover text-xs font-semibold text-content inline-flex items-center gap-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Share</span>
            </button>
          )}

          <button
            type="button"
            onClick={onReset}
            className="px-3 py-2 rounded-xl border border-line hover:border-line-hover text-xs font-medium text-content-secondary hover:text-content inline-flex items-center gap-1 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{resetLabel}</span>
          </button>
        </div>
      </div>

      {chainTargets.length > 0 && onChainTo && (
        <div className="pt-3.5 border-t border-line space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-content">{chainHeading}</span>
            <span className="text-content-secondary">{chainSublabel}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {chainTargets.map((target) => (
              <button
                key={target.href}
                type="button"
                onClick={() => onChainTo(target.href, resolvedName)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface-elevated hover:border-line-hover text-xs font-medium text-content whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span>{target.label}</span>
                <ArrowRight className="w-3 h-3 text-content-secondary" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}

      {extraContent}
    </div>
  );
}
