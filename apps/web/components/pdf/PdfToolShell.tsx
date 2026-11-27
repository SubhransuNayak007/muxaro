'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UploadCloud,
  AlertCircle,
  Loader2,
  X,
  FileText,
} from 'lucide-react';
import { formatBytes } from '@/lib/formatters';
import { useOpenedArtifact, type OpenedArtifact } from '@/lib/opened-artifact';
import { isNativeAppRuntime } from '@/lib/native-bridge';
import GoogleDriveModal from '@/components/native/GoogleDriveModal';
import {
  type PdfProcessResult,
  sanitizeFilenameStem,
  saveWorkspaceOutput,
} from '@/lib/pdf';
import UnifiedToolWorkspace from '@/components/studio/UnifiedToolWorkspace';
import WorkspaceResultCard from '@/components/studio/WorkspaceResultCard';

const PDF_CHAIN_TARGETS = [
  { href: '/tools/pdf/compress', label: 'Compress' },
  { href: '/tools/pdf/edit', label: 'Edit / Redact' },
  { href: '/tools/pdf/sign', label: 'Sign' },
  { href: '/tools/pdf/protect', label: 'Protect' },
  { href: '/tools/pdf/watermark', label: 'Watermark' },
  { href: '/tools/pdf/rotate', label: 'Rotate' },
  { href: '/tools/pdf/reorder', label: 'Reorder' },
  { href: '/tools/pdf/view', label: 'Read & Inspect' },
];

export interface PdfToolShellProps {
  title: string;
  description: string;
  currentHref: string;
  accept?: string;
  multiple?: boolean;
  requiresFile?: boolean;
  filePromptLabel?: string;
  fileHelperText?: string;
  submitLabel?: string;
  canSubmit?: boolean;
  hideSubmitBar?: boolean;
  selectedFiles?: File[];
  onFilesSelected?: (files: File[]) => void;
  onRun?: (onProgress: (pct: number, status?: string) => void, signal: AbortSignal) => Promise<PdfProcessResult | null>;
  externalResult?: PdfProcessResult | null;
  onClearExternalResult?: () => void;
  children: React.ReactNode;
}

/**
 * Unified Browser-Local PDF Studio Shell backed by UnifiedToolWorkspace:
 * - Persistent Session File Shelf + 1-click OpenedArtifact handoff
 * - Keyboard-activatable dropzone (Enter/Space)
 * - Non-blocking progress bar (GPU scaleX transform) + instant AbortSignal cancellation
 * - Shared WorkspaceResultCard with inline rename, download, Web Share, IndexedDB Recent save, and chaining
 */
export default function PdfToolShell({
  title,
  description,
  currentHref,
  accept = 'application/pdf,.pdf',
  multiple = false,
  requiresFile = true,
  filePromptLabel = 'Choose a PDF file or drag and drop here',
  fileHelperText = 'Processed 100% locally in your browser. Zero server uploads.',
  submitLabel = 'Run tool',
  canSubmit = true,
  hideSubmitBar = false,
  selectedFiles = [],
  onFilesSelected,
  onRun,
  externalResult = null,
  onClearExternalResult,
  children,
}: PdfToolShellProps) {
  const router = useRouter();
  const { artifact, setArtifactFromBlob, setArtifactFromFile } = useOpenedArtifact();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const consumedHandoffRef = useRef(false);

  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [internalResult, setInternalResult] = useState<PdfProcessResult | null>(null);
  const [isNativeApp, setIsNativeApp] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);

  useEffect(() => {
    setIsNativeApp(isNativeAppRuntime());
  }, []);

  const activeResult = externalResult ?? internalResult;

  // Auto-consume handoff when navigated with ?handoff=1
  useEffect(() => {
    if (consumedHandoffRef.current) return;
    if (typeof window === 'undefined' || !onFilesSelected) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('handoff') === '1' && artifact?.file && artifact.domain === 'pdf') {
      consumedHandoffRef.current = true;
      onFilesSelected([artifact.file]);
    }
  }, [artifact, onFilesSelected]);

  const prevInternalUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const nextUrl = internalResult?.url || null;
    if (prevInternalUrlRef.current && prevInternalUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(prevInternalUrlRef.current);
    }
    prevInternalUrlRef.current = nextUrl;
  }, [internalResult?.url]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (prevInternalUrlRef.current) {
        URL.revokeObjectURL(prevInternalUrlRef.current);
        prevInternalUrlRef.current = null;
      }
    };
  }, []);

  const acceptFiles = (list: FileList | null) => {
    if (!list || list.length === 0 || !onFilesSelected) return;
    setErrorMsg(null);
    setInternalResult(null);
    onClearExternalResult?.();
    const arr = Array.from(list);
    const first = arr[0];
    if (first) {
      const domain: OpenedArtifact['domain'] = first.type.startsWith('image/') ? 'image' : 'pdf';
      setArtifactFromFile(first, domain, currentHref);
    }
    onFilesSelected(multiple ? arr : [first]);
  };

  const handleUseArtifact = (targetArtifact?: OpenedArtifact) => {
    const item = targetArtifact ?? artifact;
    if (!item?.file || !onFilesSelected) return;
    setErrorMsg(null);
    setInternalResult(null);
    onClearExternalResult?.();
    if (multiple) {
      const alreadyLoaded = selectedFiles.some(
        (f) => f.name === item.file.name && f.size === item.file.size
      );
      onFilesSelected(alreadyLoaded ? selectedFiles : [...selectedFiles, item.file]);
    } else {
      onFilesSelected([item.file]);
    }
  };

  const handleExecute = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!onRun) return;
    setErrorMsg(null);
    setRunning(true);
    setProgressPct(4);
    setProgressText('Initializing local engine…');
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await onRun((pct, status) => {
        setProgressPct(Math.max(2, Math.min(100, pct)));
        if (status) setProgressText(status);
      }, ctrl.signal);

      if (res) {
        setInternalResult(res);
        if (!res.skippedCompression) {
          void saveWorkspaceOutput({
            fileName: res.fileName,
            toolName: title,
            toolHref: currentHref,
            domain: 'pdf',
            mimeType: res.mimeType,
            sizeBytes: res.sizeBytes,
            blob: res.blob,
          });
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setErrorMsg(err instanceof Error ? err.message : 'Processing failed.');
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const resolveOutputName = (requestedName: string) => {
    if (!activeResult) return 'output.pdf';
    const targetName = requestedName.trim() || activeResult.fileName;
    const ext = activeResult.fileName.includes('.')
      ? activeResult.fileName.slice(activeResult.fileName.lastIndexOf('.'))
      : '';
    const safeStem = sanitizeFilenameStem(targetName, 'output');
    return targetName.endsWith(ext) && !/[<>:"/\\|?*\x00-\x1f]/.test(targetName)
      ? targetName
      : `${safeStem}${ext}`;
  };

  const handleDownload = (requestedName: string) => {
    if (!activeResult) return;
    const finalName = resolveOutputName(requestedName);
    const a = document.createElement('a');
    a.href = activeResult.url;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleShare = async (requestedName: string) => {
    if (!activeResult || typeof navigator === 'undefined' || !navigator.share) return;
    try {
      const finalName = resolveOutputName(requestedName);
      const file = new File([activeResult.blob], finalName, {
        type: activeResult.mimeType,
      });
      await navigator.share({ files: [file], title: file.name });
    } catch {
      // User cancelled share sheet
    }
  };

  const handleChainTo = (targetHref: string, requestedName: string) => {
    if (!activeResult) return;
    const finalName = resolveOutputName(requestedName);
    setArtifactFromBlob(activeResult.blob, finalName, 'pdf', currentHref);
    router.push(`${targetHref}?handoff=1`);
  };

  const handleResetResult = () => {
    setInternalResult(null);
    onClearExternalResult?.();
    setErrorMsg(null);
  };

  const isPdfResult = activeResult?.mimeType === 'application/pdf';
  const showHandoffBanner =
    Boolean(onFilesSelected) &&
    artifact?.domain === 'pdf' &&
    selectedFiles.length === 0 &&
    artifact.sourceToolHref !== currentHref;

  return (
    <UnifiedToolWorkspace
      suite="pdf"
      currentHref={currentHref}
      title={title}
      description={description}
      backHref="/tools?section=pdf"
      backLabel="All PDF Tools"
      historyHref="/tools/pdf/recent"
      historyLabel="Local History"
      statusLabel={isNativeApp ? 'On-Device Local Engine · 100% Offline' : 'Browser Local, 0 bytes uploaded'}
      statusTone="local"
      activeLoadedNames={selectedFiles.map((f) => f.name)}
      onSelectSessionArtifact={
        onFilesSelected ? (item) => handleUseArtifact(item) : undefined
      }
    >
      <GoogleDriveModal
        open={driveOpen}
        onClose={() => setDriveOpen(false)}
        onImported={(file) => {
          if (!onFilesSelected) return;
          setErrorMsg(null);
          setInternalResult(null);
          onClearExternalResult?.();
          const domain: OpenedArtifact['domain'] = file.type.startsWith('image/') ? 'image' : 'pdf';
          setArtifactFromFile(file, domain, currentHref);
          onFilesSelected(multiple ? [...selectedFiles, file] : [file]);
        }}
      />
      <form onSubmit={handleExecute} className="space-y-6">
        {/* Quick 1-click Handoff from Previous Tool */}
        {showHandoffBanner && artifact && (
          <div className="p-3.5 rounded-xl border border-brand/30 bg-brand/5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <FileText className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
              <div className="text-xs sm:text-sm text-content truncate">
                Ready from previous tool: <strong className="font-semibold">{artifact.file.name}</strong>{' '}
                <span className="text-content-secondary font-mono tabular-nums">
                  ({formatBytes(artifact.file.size)})
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleUseArtifact(artifact)}
              className="px-3.5 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-brand-fg text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Use this PDF
            </button>
          </div>
        )}

        {/* Keyboard-Accessible File Input Zone */}
        {onFilesSelected && (
          <div
            data-dropzone="true"
            role="button"
            tabIndex={0}
            aria-label={
              selectedFiles.length > 0
                ? `Loaded ${selectedFiles.length} file(s). Press Enter to replace or add files.`
                : filePromptLabel
            }
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              acceptFiles(e.dataTransfer.files);
            }}
            className={`rounded-2xl border-2 border-dashed transition-colors p-5 sm:p-6 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              dragActive
                ? 'border-brand bg-brand/5'
                : 'border-line bg-surface hover:border-line-hover'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              multiple={multiple}
              className="sr-only"
              onChange={(e) => {
                acceptFiles(e.target.files);
                e.target.value = '';
              }}
            />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-surface-elevated border border-line flex items-center justify-center shrink-0 text-content-secondary">
                  <UploadCloud className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-content">
                    {selectedFiles.length > 0
                      ? multiple
                        ? `${selectedFiles.length} file(s) loaded`
                        : selectedFiles[0].name
                      : filePromptLabel}
                  </div>
                  <div className="text-xs text-content-secondary mt-0.5">
                    {selectedFiles.length > 0
                      ? `${formatBytes(selectedFiles.reduce((s, f) => s + f.size, 0))} (${fileHelperText})`
                      : fileHelperText}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {isNativeApp && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDriveOpen(true);
                    }}
                    className="px-3 py-2 rounded-xl border border-brand/30 bg-brand/10 text-brand text-xs font-semibold whitespace-nowrap hover:bg-brand/15"
                  >
                    Google Drive
                  </button>
                )}
                <span className="px-4 py-2 rounded-xl border border-line bg-surface-elevated text-xs sm:text-sm font-semibold text-content whitespace-nowrap">
                  {selectedFiles.length > 0 ? (multiple ? '+ Add files' : 'Replace file') : 'Choose file'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tool-specific Workspace Controls */}
        {children}

        {/* Error Banner */}
        {errorMsg && (
          <div
            role="alert"
            className="p-4 rounded-xl border border-error/30 bg-error-bg text-error text-sm flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Primary Action & Live Progress */}
        {!hideSubmitBar && onRun && (
          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={running || !canSubmit || (requiresFile && selectedFiles.length === 0)}
                className="px-6 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-brand-fg text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {running ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Processing locally…</span>
                  </>
                ) : (
                  <span>{submitLabel}</span>
                )}
              </button>

              {running && (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="px-3.5 py-2 rounded-xl border border-line bg-surface text-xs font-medium text-content-secondary hover:text-content inline-flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Cancel</span>
                </button>
              )}
            </div>

            {running && (
              <div className="flex-1 min-w-[200px] max-w-md space-y-1.5" role="status" aria-live="polite">
                <div className="flex items-center justify-between text-xs text-content-secondary">
                  <span>{progressText || 'Working…'}</span>
                  <span className="font-mono tabular-nums">{progressPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-elevated overflow-hidden">
                  <div
                    className="h-full bg-brand origin-left transition-transform duration-150"
                    style={{ transform: `scaleX(${Math.max(0.02, progressPct / 100)})` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </form>

      {activeResult && (
        <WorkspaceResultCard
          fileName={activeResult.fileName}
          sizeBytes={activeResult.sizeBytes}
          elapsedMs={activeResult.elapsedMs}
          summary={activeResult.summary}
          statusLabel="Browser Local"
          warnings={activeResult.warnings}
          editableName
          onDownload={handleDownload}
          onShare={handleShare}
          onReset={handleResetResult}
          resetLabel="Clear"
          chainHeading="Continue in another PDF tool"
          chainSublabel="Zero re-upload, stays in browser memory"
          chainTargets={isPdfResult ? PDF_CHAIN_TARGETS.filter((t) => t.href !== currentHref) : []}
          onChainTo={handleChainTo}
        />
      )}
    </UnifiedToolWorkspace>
  );
}
