import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, Lightbulb, ShieldAlert } from 'lucide-react';
import CodeBlockWithCopy from '@/components/CodeBlockWithCopy';
import { normalizeHref, type MarkdownBlock } from '@/lib/markdown';

function renderInline(text: string, depth = 0): React.ReactNode[] {
  if (depth > 3) return [text];
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-content">
          {renderInline(token.slice(2, -2), depth + 1)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={key++} className="italic text-content-secondary">
          {renderInline(token.slice(1, -1), depth + 1)}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded-sm bg-surface-elevated border border-line-subtle font-mono text-[0.85em] text-content"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        const label = linkMatch[1];
        const href = normalizeHref(linkMatch[2]);
        if (href.startsWith('/')) {
          nodes.push(
            <Link
              key={key++}
              href={href}
              className="text-brand font-medium hover:underline underline-offset-2"
            >
              {renderInline(label, depth + 1)}
            </Link>
          );
        } else {
          nodes.push(
            <a
              key={key++}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand font-medium hover:underline underline-offset-2"
            >
              {renderInline(label, depth + 1)}
            </a>
          );
        }
      } else {
        nodes.push(token);
      }
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

const ALERT_STYLES = {
  NOTE: { border: 'border-brand', label: 'Note', Icon: Info },
  TIP: { border: 'border-success', label: 'Tip', Icon: Lightbulb },
  IMPORTANT: { border: 'border-brand', label: 'Important', Icon: Info },
  WARNING: { border: 'border-warning', label: 'Warning', Icon: AlertTriangle },
  CAUTION: { border: 'border-error', label: 'Caution', Icon: ShieldAlert },
} as const;

export default function MarkdownRenderer({ blocks }: { blocks: MarkdownBlock[] }) {
  return (
    <div className="max-w-3xl text-sm sm:text-base text-content-secondary leading-relaxed space-y-4">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'h2':
            return (
              <h2
                key={idx}
                id={block.id}
                className="scroll-mt-24 text-2xl sm:text-[1.75rem] font-display font-medium text-content tracking-[-0.02em] mt-10 mb-3 pt-6 border-t border-line-subtle first:mt-0 first:pt-0 first:border-t-0"
              >
                {renderInline(block.text)}
              </h2>
            );
          case 'h3':
            return (
              <h3
                key={idx}
                id={block.id}
                className="scroll-mt-24 text-base sm:text-lg font-semibold text-content mt-7 mb-2"
              >
                {renderInline(block.text)}
              </h3>
            );
          case 'h4':
            return (
              <h4
                key={idx}
                id={block.id}
                className="scroll-mt-24 text-sm sm:text-base font-semibold text-content mt-5 mb-1.5"
              >
                {renderInline(block.text)}
              </h4>
            );
          case 'hr':
            return <hr key={idx} className="my-6 border-line-subtle" />;
          case 'code':
            return <CodeBlockWithCopy key={idx} lang={block.lang} content={block.content} />;
          case 'blockquote': {
            const alert = block.alertType ? ALERT_STYLES[block.alertType] : null;
            const AlertIcon = alert?.Icon;
            return (
              <blockquote
                key={idx}
                className={`border-l-2 ${
                  alert ? alert.border : 'border-brand'
                } bg-surface-elevated rounded-r-xl px-4 py-3.5 text-sm text-content-secondary space-y-1.5 my-5`}
              >
                {alert && AlertIcon && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-content mb-1">
                    <AlertIcon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{alert.label}</span>
                  </div>
                )}
                {block.lines.map((line, lIdx) => (
                  <p key={lIdx}>{renderInline(line)}</p>
                ))}
              </blockquote>
            );
          }
          case 'table':
            return (
              <div key={idx} className="overflow-x-auto rounded-xl border border-line my-5">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-line">
                      {block.headers.map((header, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-4 py-2.5 font-semibold text-content whitespace-nowrap"
                        >
                          {renderInline(header)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle bg-surface">
                    {block.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-surface-elevated/50 transition-colors">
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="px-4 py-2.5 text-content-secondary align-top">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'ul':
            return (
              <ul key={idx} className="list-disc pl-5 space-y-2 text-content-secondary">
                {block.items.map((item, iIdx) => {
                  const checkboxMatch = /^\[([ xX])\]\s+(.*)$/.exec(item);
                  if (checkboxMatch) {
                    const checked = checkboxMatch[1].toLowerCase() === 'x';
                    return (
                      <li key={iIdx} className="list-none -ml-5 flex items-start gap-2 leading-relaxed">
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          aria-label={checkboxMatch[2]}
                          className="mt-1 rounded border-line"
                        />
                        <span>{renderInline(checkboxMatch[2])}</span>
                      </li>
                    );
                  }
                  return (
                    <li key={iIdx} className="leading-relaxed">
                      {renderInline(item)}
                    </li>
                  );
                })}
              </ul>
            );
          case 'ol':
            return (
              <ol key={idx} className="list-decimal pl-5 space-y-2 text-content-secondary">
                {block.items.map((item, iIdx) => (
                  <li key={iIdx} className="leading-relaxed">
                    {renderInline(item)}
                  </li>
                ))}
              </ol>
            );
          case 'p':
            return (
              <p key={idx} className="text-content-secondary leading-relaxed">
                {renderInline(block.text)}
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
