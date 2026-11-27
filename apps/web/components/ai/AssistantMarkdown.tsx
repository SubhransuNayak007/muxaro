'use client';

import React from 'react';

function renderInlineSegments(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(text.slice(lastIndex, m.index));
    }
    const tok = m[0];
    if (tok.startsWith('**') && tok.endsWith('**')) {
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

/**
 * Cleanly renders structured Markdown in AI assistant bubbles (headings, bullet/numbered lists, bold, inline code)
 * so raw '**' tokens never appear in user-facing responses.
 */
export default function AssistantMarkdown({ content }: { content: string }) {
  const lines = (content || '').split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listItems: { ordered: boolean; text: string }[] = [];

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

  lines.forEach((rawLine, idx) => {
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

    const trimmed = line.trim();
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

  flushList('end');

  return <div className="space-y-2 text-[13.5px] leading-relaxed">{blocks}</div>;
}
