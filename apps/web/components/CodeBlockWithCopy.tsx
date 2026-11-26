'use client';

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function CodeBlockWithCopy({
  lang,
  content,
}: {
  lang: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  return (
    <div className="my-5 rounded-xl border border-line bg-surface-elevated overflow-hidden">
      <div className="px-4 py-2 border-b border-line-subtle flex items-center justify-between text-[11px] font-mono text-content-secondary">
        <span>{lang || 'diagram'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 hover:text-content transition-colors"
          aria-label="Copy code snippet"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-success" aria-hidden="true" />
              <span className="text-success">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-xs sm:text-sm font-mono text-content leading-relaxed m-0">
        <code>{content}</code>
      </pre>
    </div>
  );
}
