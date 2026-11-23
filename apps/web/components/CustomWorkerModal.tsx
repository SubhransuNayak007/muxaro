'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Server,
  X,
  CheckCircle2,
  AlertCircle,
  Save,
  RotateCcw,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { useMuxaroSettings } from '@/lib/settings-store';

interface CustomWorkerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CustomWorkerModal({ isOpen, onClose }: CustomWorkerModalProps) {
  const { settings, mounted, updateSettings } = useMuxaroSettings();
  const [workerUrl, setWorkerUrl] = useState<string>('');
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<boolean>(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mounted) {
      setWorkerUrl(settings.customWorkerUrl || '');
    }
  }, [mounted, settings.customWorkerUrl]);

  // Focus input on open & handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    inputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleTestEndpoint = async () => {
    const target = workerUrl.trim();
    if (!target) {
      setTestResult({
        success: false,
        message: 'Please enter a worker URL to test.',
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const cleanUrl = target.replace(/\/+$/, '');
      const healthUrl = cleanUrl.endsWith('/health') ? cleanUrl : `${cleanUrl}/health`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setTestResult({
          success: true,
          message: `Worker healthy (${data.worker || data.service || 'connected'}). Lossless line-speed stream copy ready.`,
        });
      } else {
        setTestResult({
          success: false,
          message: `Endpoint returned HTTP status ${res.status}. Check endpoint route and CORS settings.`,
        });
      }
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError';
      setTestResult({
        success: false,
        message: isTimeout
          ? 'Connection timed out after 6 seconds. Verify your container is running and port is exposed.'
          : `Connection failed: ${err.message || 'Network unreachable'}. Check CORS and container status.`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const clean = workerUrl.trim();
    updateSettings('customWorkerUrl', clean);

    // Save directly to localStorage for immediate non-React client consumers
    if (typeof window !== 'undefined') {
      try {
        if (clean) {
          window.localStorage.setItem('muxaro_custom_worker_url', clean);
        } else {
          window.localStorage.removeItem('muxaro_custom_worker_url');
        }
      } catch {}
    }

    setSaveFeedback(true);
    setTimeout(() => {
      setSaveFeedback(false);
      onClose();
    }, 1200);
  };

  const handleReset = () => {
    setWorkerUrl('');
    updateSettings('customWorkerUrl', '');
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('muxaro_custom_worker_url');
      } catch {}
    }
    setTestResult({
      success: true,
      message: 'Reset to default MUXARO cloud serverless gateway.',
    });
    setTimeout(() => setTestResult(null), 2500);
  };

  const handleSetLocalPreset = () => {
    setWorkerUrl('http://localhost:5001');
    setTestResult(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-worker-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-2xl bg-surface border border-line shadow-2xl p-6 sm:p-7 space-y-5 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-surface-elevated border border-line flex items-center justify-center text-brand-violet shrink-0">
              <Server className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="custom-worker-title"
                className="text-lg font-bold text-zinc-900 dark:text-zinc-100"
              >
                Custom Worker URL
              </h2>
              <p className="text-xs text-content-secondary mt-0.5">
                Cobalt self-hosted worker model (BYO-Worker)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-content-secondary hover:text-content hover:bg-surface-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Explanation Note */}
        <div className="p-3.5 rounded-xl bg-surface-elevated border border-line text-xs text-content-secondary leading-relaxed space-y-1.5">
          <p>
            <strong className="text-zinc-900 dark:text-zinc-100">Why use a custom worker?</strong> Platforms like YouTube and Instagram strictly block free cloud datacenter IPs.
          </p>
          <p>
            By running your own Docker media-worker on <code className="font-mono text-zinc-900 dark:text-zinc-100 px-1 py-0.5 bg-surface rounded">localhost:5001</code> or your personal VPS, all media requests stream through your residential connection with zero bot-blocking.
          </p>
        </div>

        {/* Input & Presets */}
        <div className="space-y-3">
          <label
            htmlFor="worker-url-input"
            className="block text-xs font-bold text-zinc-900 dark:text-zinc-100"
          >
            Worker Endpoint URL
          </label>
          <input
            ref={inputRef}
            id="worker-url-input"
            type="url"
            value={workerUrl}
            onChange={(e) => setWorkerUrl(e.target.value)}
            placeholder="http://localhost:5001 or https://worker.yourdomain.com"
            className="w-full px-4 py-2.5 rounded-xl border border-line bg-surface-elevated text-zinc-900 dark:text-zinc-100 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet"
          />

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-content-secondary font-medium">Quick presets:</span>
            <button
              type="button"
              onClick={handleSetLocalPreset}
              className="px-2.5 py-1 rounded-lg bg-surface-elevated border border-line text-content-secondary hover:text-content text-xs font-mono transition-colors"
            >
              localhost:5001
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-2.5 py-1 rounded-lg bg-surface-elevated border border-line text-content-secondary hover:text-content text-xs transition-colors"
            >
              Reset to Default Cloud
            </button>
          </div>
        </div>

        {/* Test Result Feedback */}
        {testResult && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 leading-relaxed ${
              testResult.success
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div>{testResult.message}</div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-line">
          <button
            type="button"
            disabled={testing || !workerUrl.trim()}
            onClick={handleTestEndpoint}
            className="px-4 py-2 rounded-xl border border-line bg-surface hover:bg-surface-elevated text-xs font-semibold text-zinc-900 dark:text-zinc-100 transition-colors disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Test Endpoint'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-line text-xs font-medium text-content-secondary hover:text-content transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="muxaro-btn-primary px-5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saveFeedback ? 'Saved!' : 'Save Endpoint'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
