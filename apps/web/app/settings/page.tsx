'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sun,
  Download,
  Server,
  Check,
  AlertCircle,
  CheckCircle2,
  Save,
  RotateCcw,
  Trash2,
  ArrowLeft,
} from 'lucide-react';
import {
  useMuxaroSettings,
  MuxaroTheme,
  VideoQuality,
  ContainerFormat,
  AudioFormat,
} from '@/lib/settings-store';
import {
  getAutoDownloadPreference,
  setAutoDownloadPreference,
} from '@/lib/background-download';

type SettingsTab = 'appearance' | 'downloads' | 'worker';

export default function SettingsPage() {
  const { settings, mounted, updateSettings, resetSettings } = useMuxaroSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [autoDownload, setAutoDownload] = useState<boolean>(true);
  const [customWorkerInput, setCustomWorkerInput] = useState<string>('');
  const [testingWorker, setTestingWorker] = useState<boolean>(false);
  const [workerTestResult, setWorkerTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saveWorkerFeedback, setSaveWorkerFeedback] = useState<boolean>(false);
  const [clearedDataFeedback, setClearedDataFeedback] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('muxaro-auto-download');
      setAutoDownload(stored === null ? true : getAutoDownloadPreference());

      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab === 'downloads' || tab === 'video' || tab === 'audio') setActiveTab('downloads');
      else if (tab === 'worker' || tab === 'instances') setActiveTab('worker');
    }
  }, []);

  useEffect(() => {
    if (mounted) {
      setCustomWorkerInput(settings.customWorkerUrl);
    }
  }, [mounted, settings.customWorkerUrl]);

  const handleToggleAutoDownload = () => {
    const next = !autoDownload;
    setAutoDownload(next);
    setAutoDownloadPreference(next);
  };

  const handleWorkerTest = async () => {
    const target = customWorkerInput.trim();
    if (!target) {
      setWorkerTestResult({ success: false, message: 'Enter a worker URL to test.' });
      return;
    }
    setTestingWorker(true);
    setWorkerTestResult(null);
    try {
      const cleanUrl = target.replace(/\/+$/, '');
      const healthUrl = cleanUrl.endsWith('/health') ? cleanUrl : `${cleanUrl}/api/health`;
      const res = await fetch(healthUrl, { method: 'GET' });
      if (res.ok) {
        setWorkerTestResult({ success: true, message: 'Worker connected and healthy.' });
      } else {
        setWorkerTestResult({ success: false, message: `Worker returned HTTP ${res.status}.` });
      }
    } catch (err: any) {
      setWorkerTestResult({ success: false, message: err?.message || 'Connection failed.' });
    } finally {
      setTestingWorker(false);
    }
  };

  const handleWorkerSave = () => {
    const clean = customWorkerInput.trim();
    updateSettings('customWorkerUrl', clean);
    if (typeof window !== 'undefined') {
      if (clean) window.localStorage.setItem('muxaro_custom_worker_url', clean);
      else window.localStorage.removeItem('muxaro_custom_worker_url');
    }
    setSaveWorkerFeedback(true);
    setTimeout(() => setSaveWorkerFeedback(false), 1800);
  };

  const handleClearLocalData = () => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem('muxaro_downloads_history_v1');
      window.localStorage.removeItem('muxaro_user_settings');
      window.localStorage.removeItem('muxaro_custom_worker_url');
      window.sessionStorage.removeItem('muxaro_cached_jobs');
      setClearedDataFeedback(true);
      setTimeout(() => setClearedDataFeedback(false), 2000);
    } catch {}
  };

  const tabs: { id: SettingsTab; label: string; Icon: React.ElementType }[] = [
    { id: 'appearance', label: 'Appearance', Icon: Sun },
    { id: 'downloads', label: 'Download Defaults', Icon: Download },
    { id: 'worker', label: 'Worker & Data', Icon: Server },
  ];

  return (
    <div className="w-full min-h-[calc(100vh-140px)] pb-16">
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="mb-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Back to downloader</span>
            </Link>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-content tracking-[-0.03em]">
                Settings
              </h1>
              <p className="text-sm text-content-secondary mt-1">
                Preferences are stored locally in your browser. No account required.
              </p>
            </div>
            <button
              type="button"
              onClick={resetSettings}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-line bg-surface text-xs font-semibold text-content-secondary hover:text-content transition-colors self-start sm:self-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset defaults</span>
            </button>
          </div>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Clean 3-Tab Switcher */}
        <div className="flex flex-wrap gap-2">
          {tabs.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold border transition-colors ${
                  active
                    ? 'bg-content text-base border-content'
                    : 'bg-surface border-line text-content-secondary hover:text-content'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab 1: Appearance */}
        {activeTab === 'appearance' && (
          <div className="muxaro-card p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold text-content">Theme</h2>
              <p className="text-xs text-content-secondary mt-1">
                Match your system appearance or force light/dark canvas.
              </p>
              <div className="grid grid-cols-3 gap-2.5 mt-3">
                {(['auto', 'light', 'dark'] as MuxaroTheme[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateSettings('theme', t)}
                    className={`py-2.5 px-4 rounded-xl border text-xs font-semibold capitalize transition-colors ${
                      settings.theme === t
                        ? 'bg-content text-base border-content'
                        : 'bg-base border-line text-content-secondary hover:text-content'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-5 border-t border-line flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-content">Reduce motion</h2>
                <p className="text-xs text-content-secondary mt-0.5">
                  Minimize animations and ambient background effects for faster rendering.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.reduceMotion}
                onClick={() => updateSettings('reduceMotion', !settings.reduceMotion)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  settings.reduceMotion ? 'bg-content' : 'bg-line'
                }`}
              >
                <span
                  className="inline-block h-4 w-4 rounded-full bg-surface transition-transform"
                  style={{ transform: settings.reduceMotion ? 'translateX(22px)' : 'translateX(4px)' }}
                />
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Download Defaults */}
        {activeTab === 'downloads' && (
          <div className="muxaro-card p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-content-secondary mb-1.5">
                  Default video quality
                </label>
                <select
                  value={settings.videoQuality}
                  onChange={(e) => updateSettings('videoQuality', e.target.value as VideoQuality)}
                  className="w-full px-3 py-2.5 rounded-xl border border-line bg-base text-xs font-medium text-content"
                >
                  <option value="auto">Auto (Best available)</option>
                  <option value="4320p">8K (4320p)</option>
                  <option value="2160p">4K (2160p)</option>
                  <option value="1440p">2K (1440p)</option>
                  <option value="1080p">1080p Full HD</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-content-secondary mb-1.5">
                  Default video container
                </label>
                <select
                  value={settings.containerFormat}
                  onChange={(e) => updateSettings('containerFormat', e.target.value as ContainerFormat)}
                  className="w-full px-3 py-2.5 rounded-xl border border-line bg-base text-xs font-medium text-content"
                >
                  <option value="auto">Auto (MP4)</option>
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                  <option value="webm">WebM</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-content-secondary mb-1.5">
                  Default audio format
                </label>
                <select
                  value={settings.audioFormat}
                  onChange={(e) => updateSettings('audioFormat', e.target.value as AudioFormat)}
                  className="w-full px-3 py-2.5 rounded-xl border border-line bg-base text-xs font-medium text-content"
                >
                  <option value="mp3">MP3 (320 kbps)</option>
                  <option value="flac">FLAC (Lossless)</option>
                  <option value="m4a">M4A (Apple AAC)</option>
                  <option value="opus">Opus</option>
                  <option value="wav">WAV (PCM)</option>
                </select>
              </div>
            </div>

            <div className="pt-5 border-t border-line flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-content">Mute audio by default</h2>
                <p className="text-xs text-content-secondary mt-0.5">
                  Strip audio tracks automatically when downloading video streams.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.muteVideo}
                onClick={() => updateSettings('muteVideo', !settings.muteVideo)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  settings.muteVideo ? 'bg-content' : 'bg-line'
                }`}
              >
                <span
                  className="inline-block h-4 w-4 rounded-full bg-surface transition-transform"
                  style={{ transform: settings.muteVideo ? 'translateX(22px)' : 'translateX(4px)' }}
                />
              </button>
            </div>

            <div className="pt-5 border-t border-line flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-content">Auto-save when processing finishes</h2>
                <p className="text-xs text-content-secondary mt-0.5">
                  Automatically trigger browser file save as soon as progress reaches 100%.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoDownload}
                onClick={handleToggleAutoDownload}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  autoDownload ? 'bg-content' : 'bg-line'
                }`}
              >
                <span
                  className="inline-block h-4 w-4 rounded-full bg-surface transition-transform"
                  style={{ transform: autoDownload ? 'translateX(22px)' : 'translateX(4px)' }}
                />
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Worker & Data */}
        {activeTab === 'worker' && (
          <div className="muxaro-card p-6 space-y-6">
            <div className="space-y-3">
              <h2 className="text-base font-bold text-content">Custom media worker URL</h2>
              <p className="text-xs text-content-secondary">
                Optional: point the web workspace to your own self-hosted MUXARO backend endpoint. Leave blank to use the default connected server.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={customWorkerInput}
                  onChange={(e) => setCustomWorkerInput(e.target.value)}
                  placeholder="http://localhost:3000"
                  className="muxaro-input flex-1 px-3.5 py-2.5 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleWorkerTest}
                  disabled={testingWorker}
                  className="px-4 py-2.5 rounded-xl border border-line bg-surface-elevated text-xs font-semibold text-content hover:border-line-hover"
                >
                  {testingWorker ? 'Testing…' : 'Test health'}
                </button>
                <button
                  type="button"
                  onClick={handleWorkerSave}
                  className="px-4 py-2.5 rounded-xl bg-content text-base text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  {saveWorkerFeedback ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{saveWorkerFeedback ? 'Saved' : 'Save'}</span>
                </button>
              </div>
              {workerTestResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                    workerTestResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                      : 'bg-error-bg border-error/20 text-error'
                  }`}
                >
                  {workerTestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{workerTestResult.message}</span>
                </div>
              )}
            </div>

            <div className="pt-5 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-content">Clear browser history &amp; cache</h2>
                <p className="text-xs text-content-secondary mt-0.5">
                  Removes local download history, cached jobs, and saved preferences from this browser.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearLocalData}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-error/30 bg-error-bg text-error text-xs font-semibold hover:opacity-90 shrink-0"
              >
                {clearedDataFeedback ? <Check className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{clearedDataFeedback ? 'Cleared' : 'Clear local data'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
