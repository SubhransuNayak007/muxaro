'use client';

import React, { useState } from 'react';
import { Link2, ExternalLink, Copy, Check, X } from 'lucide-react';
import { formatDisplayUrl, detectPlatform } from '@/lib/url-utils';

interface ActiveLinkIndicatorProps {
  url: string;
  onClear?: () => void;
  className?: string;
  showPlatformBadge?: boolean;
}

export default function ActiveLinkIndicator({
  url,
  onClear,
  className = '',
  showPlatformBadge = true,
}: ActiveLinkIndicatorProps) {
  const [copied, setCopied] = useState<boolean>(false);

  if (!url || !url.trim()) return null;

  const displayUrl = formatDisplayUrl(url, 36);
  const platform = detectPlatform(url);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard write failure
    }
  };

  return (
    <div
      role="region"
      aria-label="Active source link"
      className={`inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl bg-interactive border border-line shadow-xs max-w-full ${className}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Link2 className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
        {showPlatformBadge && (
          <span className="text-[11px] font-semibold text-brand shrink-0">
            {platform.name}
          </span>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={url}
          className="text-xs font-mono text-content hover:text-brand underline-offset-2 hover:underline truncate max-w-[200px] sm:max-w-[320px] rounded-sm"
        >
          {displayUrl}
        </a>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open source link in new tab: ${url}`}
          className="text-content-muted hover:text-brand p-0.5 rounded-sm shrink-0"
        >
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy source link to clipboard"
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-surface border border-line hover:bg-surface-muted text-content text-[11px] font-medium transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-success shrink-0" aria-hidden="true" />
              <span className="text-success font-semibold">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 text-content-muted shrink-0" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>

        {onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear active link"
            title="Clear link"
            className="p-1 rounded-lg text-content-muted hover:text-error hover:bg-error-bg/50 transition-colors"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
