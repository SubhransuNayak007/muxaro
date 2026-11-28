'use client';

import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

function renderInlineSegments(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Handles blocked external images (![alt](url)), markdown links ([label](url)), bold, italic, and inline code
  const regex =
    /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(text.slice(lastIndex, m.index));
    }
    const tok = m[0];
    if (tok.startsWith('![')) {
      // Lethal Trifecta Exfiltration Defense: never auto-fetch untrusted remote markdown images!
      const alt = m[2] || 'external image';
      parts.push(
        <span
          key={k++}
          className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-elevated border border-line text-[11px] font-mono text-content-tertiary"
        >
          [External image blocked: {alt}]
        </span>
      );
    } else if (m[4] && m[5]) {
      parts.push(
        <a
          key={k++}
          href={m[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand underline underline-offset-2 hover:opacity-85 break-all"
        >
          {m[4]}
        </a>
      );
    } else if (tok.startsWith('**') && tok.endsWith('**')) {
      parts.push(
        <strong key={k++} className="font-semibold text-content">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith('*') && tok.endsWith('*')) {
      parts.push(
        <em key={k++} className="italic text-content-secondary">
          {tok.slice(1, -1)}
        </em>
      );
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      parts.push(
        <code
          key={k++}
          className="px-1 py-0.5 rounded bg-surface-elevated border border-line font-mono text-[12px] text-content"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function FencedCodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="rounded-xl border border-line bg-surface-elevated overflow-hidden my-2">
      <div className="px-3 py-1.5 border-b border-line flex items-center justify-between text-[11px] text-content-secondary">
        <span className="font-mono">{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded px-1"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono text-content leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Cleanly renders structured Markdown in AI assistant bubbles (headings, tables,
 * fenced code blocks with copy, lists, safe links, while blocking external image beacons).
 */
export default function AssistantMarkdown({ content }: { content: string }) {
  const lines = (content || '').split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listItems: { ordered: boolean; text: string }[] = [];
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let tableRows: string[][] = [];

  const flushList = (keyBase: string | number) => {
    if (listItems.length === 0) return;
    const isOrdered = listItems[0].ordered;
    const Tag = isOrdered ? 'ol' : 'ul';
    blocks.push(
      <Tag
        key={`list-${keyBase}`}
        className={`space-y-1.5 pl-4 ${isOrdered ? 'list-decimal' : 'list-disc'}`}
      >
        {listItems.map((it, i) => (
          <li key={i} className="leading-relaxed">
            {renderInlineSegments(it.text)}
          </li>
        ))}
      </Tag>
    );
    listItems = [];
  };

  const flushTable = (keyBase: string | number) => {
    if (tableRows.length === 0) return;
    const rows = tableRows.filter((r) => !r.every((c) => /^[-:\s]+$/.test(c)));
    if (rows.length > 0) {
      const headers = rows[0];
      const body = rows.slice(1);
      blocks.push(
        <div key={`tbl-${keyBase}`} className="overflow-x-auto rounded-xl border border-line my-2">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-elevated border-b border-line">
                {headers.map((h, hi) => (
                  <th key={hi} className="px-2.5 py-1.5 font-semibold text-content whitespace-nowrap">
                    {renderInlineSegments(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-b last:border-b-0 border-line">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2.5 py-1.5 text-content-secondary">
                      {renderInlineSegments(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    tableRows = [];
  };

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      if (!inCode) {
        flushList(idx);
        flushTable(idx);
        inCode = true;
        codeLang = trimmed.slice(3).trim();
        codeLines = [];
      } else {
        inCode = false;
        blocks.push(<FencedCodeBlock key={`code-${idx}`} lang={codeLang} code={codeLines.join('\n')} />);
        codeLang = '';
        codeLines = [];
      }
      return;
    }

    if (inCode) {
      codeLines.push(rawLine);
      return;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      flushList(idx);
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((s) => s.trim());
      tableRows.push(cells);
      return;
    }

    flushTable(idx);

    const line = rawLine.trimEnd();
    const bulletMatch = line.match(/^\s*(?:[-*•])\s+(.+)$/);
    const numMatch = line.match(/^\s*\d+\.\s+(.+)$/);

    if (bulletMatch) {
      if (listItems.length > 0 && listItems[0].ordered) flushList(idx);
      listItems.push({ ordered: false, text: bulletMatch[1] });
      return;
    }
    if (numMatch) {
      if (listItems.length > 0 && !listItems[0].ordered) flushList(idx);
      listItems.push({ ordered: true, text: numMatch[1] });
      return;
    }

    flushList(idx);

    if (!trimmed) return;

    if (/^#{1,3}\s+/.test(trimmed)) {
      blocks.push(
        <div key={`h-${idx}`} className="font-semibold text-content text-[13.5px] pt-1">
          {renderInlineSegments(trimmed.replace(/^#{1,3}\s+/, ''))}
        </div>
      );
      return;
    }

    blocks.push(
      <p key={`p-${idx}`} className="leading-relaxed">
        {renderInlineSegments(trimmed)}
      </p>
    );
  });

  if (inCode && codeLines.length > 0) {
    blocks.push(<FencedCodeBlock key="code-end" lang={codeLang} code={codeLines.join('\n')} />);
  }
  flushTable('end');
  flushList('end');

  return <div className="space-y-2 text-[13.5px] leading-relaxed">{blocks}</div>;
}
