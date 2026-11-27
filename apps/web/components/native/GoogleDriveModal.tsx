'use client';

import React, { useState } from 'react';
import { Cloud, Loader2, X, AlertCircle, Link2, CheckCircle2 } from 'lucide-react';
import { fetchRemoteUrlToFile, resolveGoogleDriveDownloadUrl } from '@/lib/native-bridge';
import { formatBytes } from '@/lib/formatters';

interface GoogleDriveModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (file: File) => void;
}

export default function GoogleDriveModal({
  open,
  onClose,
  onImported,
}: GoogleDriveModalProps) {
  const [driveInput, setDriveInput] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedMeta, setImportedMeta] = useState<{ name: string; size: number } | null>(null);

  if (!open) return null;

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = driveInput.trim();
    if (!raw) {
      setError('Paste a Google Drive link, file ID, or direct file URL.');
      return;
    }

    setError(null);
    setLoading(true);
    setImportedMeta(null);

    try {
      const file = await fetchRemoteUrlToFile(raw, accessToken.trim() || undefined);
      setImportedMeta({ name: file.name, size: file.size });
      onImported(file);
      setTimeout(() => {
        setDriveInput('');
        setImportedMeta(null);
        onClose();
      }, 280);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not download from Google Drive. Make sure sharing is set to "Anyone with the link" or provide an OAuth access token.'
      );
    } finally {
      setLoading(false);
    }
  };

  const preview = driveInput.trim() ? resolveGoogleDriveDownloadUrl(driveInput) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Import file from Google Drive"
      onClick={onClose}
    >
      <div
        className="muxaro-liquid-glass muxaro-sheet-enter w-full max-w-md rounded-2xl p-5 sm:p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand/12 border border-brand/25 flex items-center justify-center text-brand">
              <Cloud className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-content">Import from Google Drive</h2>
              <p className="text-[11px] text-content-secondary">
                Downloads directly to local workspace for offline processing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Google Drive importer"
            className="w-8 h-8 rounded-lg bg-surface-elevated border border-line flex items-center justify-center text-content-secondary hover:text-content"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleImport} className="space-y-3.5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-content-secondary">
              Google Drive link or file ID
            </span>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-elevated border border-line focus-within:border-brand">
              <Link2 className="w-4 h-4 text-content-tertiary shrink-0" />
              <input
                type="text"
                value={driveInput}
                onChange={(e) => setDriveInput(e.target.value)}
                placeholder="https://drive.google.com/file/d/.../view"
                autoFocus
                className="w-full bg-transparent text-xs sm:text-sm text-content placeholder:text-content-tertiary focus:outline-none"
              />
            </div>
          </label>

          {preview?.isDrive && preview.fileId && (
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-1.5 font-mono truncate">
              Detected Drive File ID: {preview.fileId}
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[11px] font-medium text-brand hover:underline"
            >
              {showAdvanced ? 'Hide private file OAuth token' : 'Importing a private Drive file? Add OAuth token'}
            </button>
            {showAdvanced && (
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="ya29.... (optional Drive API OAuth Bearer token)"
                className="mt-2 w-full px-3 py-2 rounded-xl bg-surface-elevated border border-line text-xs font-mono text-content focus:outline-none focus:border-brand"
              />
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-error-bg border border-error/30 text-error text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {importedMeta && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">
                Loaded {importedMeta.name} ({formatBytes(importedMeta.size)})
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-surface-elevated border border-line text-xs font-medium text-content-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !driveInput.trim()}
              className="muxaro-spring-tap px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Fetching locally…</span>
                </>
              ) : (
                <span>Import to Local Studio</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
