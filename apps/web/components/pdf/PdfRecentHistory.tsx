'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Trash2, ArrowRight, History } from 'lucide-react';
import { formatBytes } from '@/lib/formatters';
import { useOpenedArtifact } from '@/lib/opened-artifact';
import {
  clearAllWorkspaceOutputs,
  deleteWorkspaceOutput,
  listWorkspaceOutputs,
  type LocalWorkspaceOutputItem,
} from '@/lib/pdf';

export default function PdfRecentHistory() {
  const router = useRouter();
  const { setArtifactFromBlob } = useOpenedArtifact();
  const [items, setItems] = useState<LocalWorkspaceOutputItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setItems(await listWorkspaceOutputs());
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const handleDownload = (item: LocalWorkspaceOutputItem) => {
    if (!item.blob) return;
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleContinue = (item: LocalWorkspaceOutputItem) => {
    if (!item.blob) return;
    setArtifactFromBlob(item.blob, item.fileName, 'pdf', '/tools/pdf/recent');
    router.push('/tools/pdf/view?handoff=1');
  };

  return (
    <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/tools?section=pdf"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to PDF Tools</span>
        </Link>

        {items.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              await clearAllWorkspaceOutputs();
              setItems([]);
            }}
            className="px-3.5 py-1.5 rounded-xl border border-line text-xs font-semibold text-error hover:bg-error-bg"
          >
            Clear local history
          </button>
        )}
      </div>

      <div>
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-content-secondary mb-2">
          <History className="w-4 h-4" />
          <span>Browser IndexedDB Storage (up to 50 outputs)</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-content tracking-tight">
          Local PDF History
        </h1>
        <p className="text-sm text-content-secondary mt-1">
          Files shown here are stored strictly inside your browser&apos;s IndexedDB and never leave your device.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-content-secondary">Loading local history…</div>
      ) : items.length === 0 ? (
        <div className="p-8 rounded-2xl border border-line bg-surface text-center space-y-2">
          <p className="text-sm font-semibold text-content">No local PDF outputs yet</p>
          <p className="text-xs text-content-secondary">
            Any PDF you generate or process will appear here for quick re-download or chaining.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-2xl border border-line bg-surface flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-bold text-content truncate">{item.fileName}</div>
                <div className="text-xs text-content-secondary mt-0.5">
                  {item.toolName} · {formatBytes(item.sizeBytes)} ·{' '}
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {item.blob && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDownload(item)}
                      className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                    {item.mimeType === 'application/pdf' && (
                      <button
                        type="button"
                        onClick={() => handleContinue(item)}
                        className="px-3 py-1.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <span>Open</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await deleteWorkspaceOutput(item.id);
                    setItems((prev) => prev.filter((x) => x.id !== item.id));
                  }}
                  aria-label={`Delete ${item.fileName}`}
                  className="p-2 rounded-xl border border-line text-content-secondary hover:text-error"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
