'use client';

import React, { useState } from 'react';
import { Terminal, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

interface CommandPreviewDrawerProps {
  command: string;
  label?: string;
  defaultOpen?: boolean;
  instantBadge?: boolean;
}

/**
 * Power-user FFmpeg command transparency drawer.
 * Displays exact generated CLI flags with one-click copy.
 */
export default function CommandPreviewDrawer({
  command,
  label = 'Show FFmpeg command',
  defaultOpen = false,
  instantBadge = false,
}: CommandPreviewDrawerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  if (!command) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="rounded-xl border border-line bg-surface-elevated/70 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 text-xs font-medium text-content-secondary hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content rounded"
          aria-expanded={open}
        >
          <Terminal className="w-3.5 h-3.5 text-content" aria-hidden="true" />
          <span>{label}</span>
          {instantBadge && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 text-[10px] font-mono">
              Instant copy
            </span>
          )}
          {open ? (
            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-line bg-surface hover:bg-surface-elevated text-content-secondary hover:text-content transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-500" aria-hidden="true" />
              <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {open && (
        <div className="px-3.5 pb-3 pt-1 border-t border-line/60 bg-base/60 overflow-x-auto">
          <pre className="text-[11px] leading-relaxed font-mono text-content whitespace-pre-wrap break-all">
            {command}
          </pre>
        </div>
      )}
    </div>
  );
}
