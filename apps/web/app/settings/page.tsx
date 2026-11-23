'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sun,
  Eye,
  Film,
  Music,
  Tag,
  Cpu,
  Server,
  ShieldCheck,
  Sliders,
  ChevronDown,
  Check,
  AlertCircle,
  CheckCircle2,
  Save,
  RotateCcw,
  Trash2,
  ArrowLeft,
  Smartphone,
  Laptop,
  Zap,
} from 'lucide-react';
import {
  useMuxaroSettings,
  MuxaroTheme,
  VideoQuality,
  VideoCodec,
  ContainerFormat,
  AudioFormat,
  AudioBitrate,
  StreamChunkSize,
  RequestTimeout,
} from '@/lib/settings-store';
import { useMuxaroBridge } from '@/hooks/useMuxaroBridge';

type SettingsTab =
  | 'appearance'
  | 'accessibility'
  | 'video'
  | 'audio'
  | 'metadata'
  | 'local_processing'
  | 'instances'
  | 'privacy'
  | 'advanced';

export default function SettingsPage() {
  const { settings, mounted, updateSettings, resetSettings } = useMuxaroSettings();
  const { isDirectInstalled, isMobile, checkingDirect } = useMuxaroBridge();

  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [customWorkerInput, setCustomWorkerInput] = useState<string>('');
  const [testingWorker, setTestingWorker] = useState<boolean>(false);
  const [workerTestResult, setWorkerTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saveWorkerFeedback, setSaveWorkerFeedback] = useState<boolean>(false);
  const [clearedDataFeedback, setClearedDataFeedback] = useState<boolean>(false);

  useEffect(() => {
    if (mounted) {
      setCustomWorkerInput(settings.customWorkerUrl);
    }
  }, [mounted, settings.customWorkerUrl]);

  const handleWorkerTest = async () => {
    const target = customWorkerInput.trim();
    if (!target) {
      setWorkerTestResult({
        success: false,
        message: 'Please enter a worker endpoint URL to test.',
      });
      return;
    }

    setTestingWorker(true);
    setWorkerTestResult(null);

    try {
      const cleanUrl = target.replace(/\/+$/, '');
      const healthUrl = cleanUrl.endsWith('/health') ? cleanUrl : `${cleanUrl}/health`;
      const res = await fetch(healthUrl, { method: 'GET' });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setWorkerTestResult({
          success: true,
          message: `Worker healthy (${data.worker || 'connected'}). Media pipeline line-speed stream copy ready.`,
        });
      } else {
        setWorkerTestResult({
          success: false,
          message: `Worker returned HTTP status ${res.status}. Check endpoint route and CORS settings.`,
        });
      }
    } catch (err: any) {
      setWorkerTestResult({
        success: false,
        message: `Connection failed: ${err.message || 'Network unreachable'}. Verify worker container is running.`,
      });
    } finally {
      setTestingWorker(false);
    }
  };

  const handleWorkerSave = () => {
    updateSettings('customWorkerUrl', customWorkerInput.trim());
    setSaveWorkerFeedback(true);
    setTimeout(() => setSaveWorkerFeedback(false), 2200);
  };

  const handleWorkerReset = () => {
    setCustomWorkerInput('');
    updateSettings('customWorkerUrl', '');
    setWorkerTestResult({
      success: true,
      message: 'Reset to default MUXARO cloud serverless gateway.',
    });
    setTimeout(() => setWorkerTestResult(null), 3000);
  };

  const handleClearLocalData = () => {
    if (typeof window === 'undefined') return;
    try {
      const keysToRemove = [
        'muxaro_downloads',
        'muxaro_recent_jobs',
        'muxaro_cache',
      ];
      for (const k of keysToRemove) {
        window.localStorage.removeItem(k);
      }
      setClearedDataFeedback(true);
      setTimeout(() => setClearedDataFeedback(false), 2500);
    } catch {}
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'appearance', label: 'Appearance', icon: <Sun className="w-4 h-4" /> },
    { id: 'accessibility', label: 'Accessibility', icon: <Eye className="w-4 h-4" /> },
    { id: 'video', label: 'Video', icon: <Film className="w-4 h-4" /> },
    { id: 'audio', label: 'Audio', icon: <Music className="w-4 h-4" /> },
    { id: 'metadata', label: 'Metadata', icon: <Tag className="w-4 h-4" /> },
    { id: 'local_processing', label: 'Local Processing', icon: <Cpu className="w-4 h-4" /> },
    { id: 'instances', label: 'Worker Fleet', icon: <Server className="w-4 h-4" /> },
    { id: 'privacy', label: 'Privacy & Storage', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'advanced', label: 'Advanced', icon: <Sliders className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-base text-content antialiased">
      <div className="max-w-sheet mx-auto px-4 md:px-8 py-8 md:py-12 space-y-8">
        {/* Page Header */}
        <header className="space-y-2 border-b border-line pb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary hover:text-content transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to Workspace</span>
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-content">
                Settings
              </h1>
              <p className="text-sm text-content-secondary mt-1">
                Manage your display preferences, download defaults, media processing pipeline, and privacy options.
              </p>
            </div>
            {/* Device badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-line bg-surface-elevated text-xs font-medium text-content-secondary">
              {isMobile ? (
                <>
                  <Smartphone className="w-3.5 h-3.5 text-brand-violet" />
                  <span>Mobile Device Detected (2K Max)</span>
                </>
              ) : (
                <>
                  <Laptop className="w-3.5 h-3.5 text-brand-violet" />
                  <span>Desktop Device Detected (8K Ready)</span>
                </>
              )}
            </div>
          </div>
        </header>

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          {/* Navigation Sidebar */}
          <nav
            className="md:col-span-4 lg:col-span-3 flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-2 md:pb-0 scrollbar-none"
            aria-label="Settings categories"
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap text-left ${
                    isActive
                      ? 'bg-surface text-content border border-line shadow-xs font-semibold'
                      : 'text-content-secondary hover:text-content hover:bg-surface-elevated/70'
                  }`}
                >
                  <span className={isActive ? 'text-brand-violet' : 'text-content-secondary'}>
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Active Content Panel */}
          <main className="md:col-span-8 lg:col-span-9 space-y-6">
            {/* ═════════ TAB: APPEARANCE ═════════ */}
            {activeTab === 'appearance' && (
              <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-card space-y-8">
                {/* Theme Selector */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-content">Theme</h2>
                      <p className="text-xs text-content-secondary mt-0.5">
                        Choose between light, dark, or system appearance.
                      </p>
                    </div>
                  </div>

                  <div className="inline-flex items-center p-1 rounded-xl bg-surface-elevated border border-line gap-1">
                    {(['auto', 'light', 'dark'] as MuxaroTheme[]).map((t) => {
                      const isCurrent = settings.theme === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => updateSettings('theme', t)}
                          className={`px-6 py-2 rounded-lg text-xs sm:text-sm font-medium capitalize transition-all ${
                            isCurrent
                              ? 'bg-surface text-content shadow-xs font-semibold'
                              : 'text-content-secondary hover:text-content'
                          }`}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Language Settings */}
                <div className="space-y-4 pt-6 border-t border-line/60">
                  <div>
                    <h2 className="text-base font-bold text-content">Language</h2>
                    <p className="text-xs text-content-secondary mt-0.5">
                      Configure interface language and localization options.
                    </p>
                  </div>

                  {/* Auto Language Toggle */}
                  <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-content">Automatic Selection</div>
                      <div className="text-xs text-content-secondary mt-0.5">
                        MUXARO will automatically match your browser&apos;s preferred language when available.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.autoLanguage}
                      onClick={() => updateSettings('autoLanguage', !settings.autoLanguage)}
                      className={`relative w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet ${
                        settings.autoLanguage ? 'bg-brand-violet' : 'bg-line-hover'
                      }`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white shadow-xs transform transition-transform ${
                          settings.autoLanguage ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Preferred Language Select */}
                  <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-content">Preferred Language</div>
                      <div className="text-xs text-content-secondary mt-0.5">
                        Fallback language when automatic selection is disabled.
                      </div>
                    </div>
                    <div className="relative">
                      <select
                        value={settings.preferredLanguage}
                        onChange={(e) => updateSettings('preferredLanguage', e.target.value)}
                        disabled={settings.autoLanguage}
                        className="appearance-none bg-surface border border-line rounded-lg text-sm text-content font-medium pr-8 pl-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-violet disabled:opacity-50 cursor-pointer"
                      >
                        <option value="english">English</option>
                        <option value="spanish">Español</option>
                        <option value="french">Français</option>
                        <option value="german">Deutsch</option>
                        <option value="japanese">日本語</option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-content-secondary absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ═════════ TAB: ACCESSIBILITY ═════════ */}
            {activeTab === 'accessibility' && (
              <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-card space-y-6">
                <div>
                  <h2 className="text-base font-bold text-content">Visual Accessibility &amp; Motion</h2>
                  <p className="text-xs text-content-secondary mt-0.5">
                    Configure contrast and motion preferences for greater comfort.
                  </p>
                </div>

                {/* High Contrast */}
                <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-content">High Contrast Mode</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Increases border contrast and text legibility across all views.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.highContrast}
                    onClick={() => updateSettings('highContrast', !settings.highContrast)}
                    className={`relative w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet ${
                      settings.highContrast ? 'bg-brand-violet' : 'bg-line-hover'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white shadow-xs transform transition-transform ${
                        settings.highContrast ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {/* Reduced Motion */}
                <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-content">Reduce Motion</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Disables sliding animations and animated layout transitions.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.reduceMotion}
                    onClick={() => updateSettings('reduceMotion', !settings.reduceMotion)}
                    className={`relative w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet ${
                      settings.reduceMotion ? 'bg-brand-violet' : 'bg-line-hover'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white shadow-xs transform transition-transform ${
                        settings.reduceMotion ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </section>
            )}

            {/* ═════════ TAB: VIDEO ═════════ */}
            {activeTab === 'video' && (
              <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-card space-y-8">
                {/* Default Video Quality */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-content">Default Video Quality</h2>
                      <p className="text-xs text-content-secondary mt-0.5">
                        Initial resolution selected when analyzing media streams.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-surface-elevated border border-line">
                    {(['auto', '1080p', '1440p', '2160p', '4320p'] as VideoQuality[]).map((q) => {
                      const isCurrent = settings.videoQuality === q;
                      const label =
                        q === '1440p' ? '1440p (2K)' : q === '2160p' ? '2160p (4K)' : q === '4320p' ? '4320p (8K)' : q;
                      const isRestrictedOnMobile = isMobile && (q === '2160p' || q === '4320p');

                      return (
                        <button
                          key={q}
                          type="button"
                          disabled={isRestrictedOnMobile}
                          onClick={() => updateSettings('videoQuality', q)}
                          className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                            isCurrent
                              ? 'bg-surface text-content shadow-xs font-semibold'
                              : isRestrictedOnMobile
                              ? 'text-content-secondary/40 cursor-not-allowed line-through'
                              : 'text-content-secondary hover:text-content'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="text-xs text-content-secondary space-y-1">
                    {isMobile ? (
                      <p className="text-amber-500 dark:text-amber-400 font-medium">
                        ⚡ Mobile device detected: Quality is capped to 1440p (2K) for zero-latency server processing with no script installation required.
                      </p>
                    ) : (
                      <p>
                        Desktop environment detected: Up to 8K (4320p) processing is unlocked via local MUXARO Direct stream helper.
                      </p>
                    )}
                  </div>
                </div>

                {/* Video Codec */}
                <div className="space-y-3 pt-6 border-t border-line/60">
                  <div>
                    <h2 className="text-base font-bold text-content">Preferred Video Codec</h2>
                    <p className="text-xs text-content-secondary mt-0.5">
                      H.264 provides maximum universal playback, while AV1 offers superior efficiency.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-surface-elevated border border-line">
                    {(['auto', 'h264', 'av1', 'vp9'] as VideoCodec[]).map((c) => {
                      const isCurrent = settings.videoCodec === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => updateSettings('videoCodec', c)}
                          className={`px-5 py-2 rounded-lg text-xs sm:text-sm font-medium uppercase transition-all ${
                            isCurrent
                              ? 'bg-surface text-content shadow-xs font-semibold'
                              : 'text-content-secondary hover:text-content'
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Container Format */}
                <div className="space-y-3 pt-6 border-t border-line/60">
                  <div>
                    <h2 className="text-base font-bold text-content">Default Container Format</h2>
                    <p className="text-xs text-content-secondary mt-0.5">
                      Container encapsulation used for multiplexing streams.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-surface-elevated border border-line">
                    {(['auto', 'mp4', 'mkv', 'webm'] as ContainerFormat[]).map((cf) => {
                      const isCurrent = settings.containerFormat === cf;
                      return (
                        <button
                          key={cf}
                          type="button"
                          onClick={() => updateSettings('containerFormat', cf)}
                          className={`px-5 py-2 rounded-lg text-xs sm:text-sm font-medium uppercase font-mono transition-all ${
                            isCurrent
                              ? 'bg-surface text-content shadow-xs font-semibold'
                              : 'text-content-secondary hover:text-content'
                          }`}
                        >
                          {cf}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Mute Video */}
                <div className="pt-6 border-t border-line/60">
                  <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-content">Mute Downloaded Video</div>
                      <div className="text-xs text-content-secondary mt-0.5">
                        Strips audio streams completely, saving pure video only.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.muteVideo}
                      onClick={() => updateSettings('muteVideo', !settings.muteVideo)}
                      className={`relative w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet ${
                        settings.muteVideo ? 'bg-brand-violet' : 'bg-line-hover'
                      }`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white shadow-xs transform transition-transform ${
                          settings.muteVideo ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ═════════ TAB: AUDIO ═════════ */}
            {activeTab === 'audio' && (
              <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-card space-y-8">
                {/* Audio Format */}
                <div className="space-y-3">
                  <div>
                    <h2 className="text-base font-bold text-content">Default Audio Format</h2>
                    <p className="text-xs text-content-secondary mt-0.5">
                      FLAC and WAV are studio lossless; MP3 and M4A are universally compatible.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-surface-elevated border border-line">
                    {(['mp3', 'flac', 'm4a', 'opus', 'wav'] as AudioFormat[]).map((af) => {
                      const isCurrent = settings.audioFormat === af;
                      return (
                        <button
                          key={af}
                          type="button"
                          onClick={() => updateSettings('audioFormat', af)}
                          className={`px-5 py-2 rounded-lg text-xs sm:text-sm font-medium uppercase font-mono transition-all ${
                            isCurrent
                              ? 'bg-surface text-content shadow-xs font-semibold'
                              : 'text-content-secondary hover:text-content'
                          }`}
                        >
                          {af}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Audio Bitrate */}
                <div className="space-y-3 pt-6 border-t border-line/60">
                  <div>
                    <h2 className="text-base font-bold text-content">Audio Bitrate Encoding</h2>
                    <p className="text-xs text-content-secondary mt-0.5">
                      Target bitrate envelope for lossy audio extractions (MP3/M4A).
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-surface-elevated border border-line">
                    {(['320', '256', '192', '128'] as AudioBitrate[]).map((br) => {
                      const isCurrent = settings.audioBitrate === br;
                      return (
                        <button
                          key={br}
                          type="button"
                          onClick={() => updateSettings('audioBitrate', br)}
                          className={`px-5 py-2 rounded-lg text-xs sm:text-sm font-medium font-mono transition-all ${
                            isCurrent
                              ? 'bg-surface text-content shadow-xs font-semibold'
                              : 'text-content-secondary hover:text-content'
                          }`}
                        >
                          {br} kbps
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* ═════════ TAB: METADATA ═════════ */}
            {activeTab === 'metadata' && (
              <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-card space-y-6">
                <div>
                  <h2 className="text-base font-bold text-content">Metadata &amp; File Tagging</h2>
                  <p className="text-xs text-content-secondary mt-0.5">
                    Embed album art, tags, and formatting rules into downloaded media.
                  </p>
                </div>

                {/* Thumbnail Embed */}
                <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-content">Embed Thumbnail into File</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Embeds high-resolution cover art into audio ID3/Vorbis tags and MP4 atomic tags.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.embedThumbnail}
                    onClick={() => updateSettings('embedThumbnail', !settings.embedThumbnail)}
                    className={`relative w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet ${
                      settings.embedThumbnail ? 'bg-brand-violet' : 'bg-line-hover'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white shadow-xs transform transition-transform ${
                        settings.embedThumbnail ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {/* Filename Template */}
                <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-content">Output Filename Pattern</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Format structure used when saving media to disk.
                    </div>
                  </div>
                  <div className="relative">
                    <select
                      value={settings.filenameTemplate}
                      onChange={(e) => updateSettings('filenameTemplate', e.target.value as any)}
                      className="appearance-none bg-surface border border-line rounded-lg text-sm text-content font-medium pr-8 pl-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-violet cursor-pointer"
                    >
                      <option value="title">Title Only</option>
                      <option value="title_artist">Title + Artist</option>
                      <option value="title_id">Title + Media ID</option>
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-content-secondary absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </section>
            )}

            {/* ═════════ TAB: LOCAL PROCESSING ═════════ */}
            {activeTab === 'local_processing' && (
              <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-card space-y-6">
                <div>
                  <h2 className="text-base font-bold text-content">Client-Side Engine &amp; Direct Bridge</h2>
                  <p className="text-xs text-content-secondary mt-0.5">
                    Configure local browser processing to bypass serverless execution and bandwidth limits.
                  </p>
                </div>

                {/* Device Classification Card */}
                <div className="p-5 rounded-xl bg-surface-elevated border border-line flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-surface border border-line flex items-center justify-center text-brand-violet shrink-0">
                    {isMobile ? <Smartphone className="w-5 h-5" /> : <Laptop className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-content">
                      {isMobile ? 'Detected: Mobile Device (Touch Enabled)' : 'Detected: Laptop / Desktop'}
                    </div>
                    <div className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                      {isMobile
                        ? 'Mobile devices stream directly from edge servers (capped at 2K). No helper scripts or browser extensions required.'
                        : 'Desktop browsers can run in-browser stream copy helpers to unlock 4K & 8K without server egress fees.'}
                    </div>
                  </div>
                </div>

                {/* Bridge Status */}
                <div className="p-5 rounded-xl bg-surface-elevated border border-line space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-content">MUXARO Direct Companion Bridge</div>
                      <div className="text-xs text-content-secondary mt-0.5">
                        Bidirectional window.postMessage sandbox handshake
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                        isDirectInstalled
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-surface text-content-secondary border border-line'
                      }`}
                    >
                      {checkingDirect ? (
                        'Checking…'
                      ) : isDirectInstalled ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Connected (v1.1.0)</span>
                        </>
                      ) : (
                        'Not Detected'
                      )}
                    </span>
                  </div>

                  {!isMobile && (
                    <div className="pt-3 border-t border-line/60 flex items-center justify-between gap-4">
                      <span className="text-xs text-content-secondary">
                        Install Tampermonkey / Violentmonkey script for 8K direct processing
                      </span>
                      <Link
                        href="/tools/direct-helper"
                        className="px-4 py-1.5 rounded-lg muxaro-btn-primary text-xs font-bold shrink-0"
                      >
                        Configure Helper
                      </Link>
                    </div>
                  )}
                </div>

                {/* In-Browser WASM */}
                <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-content">In-Browser WebWorker &amp; WASM Muxing</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Processes split audio and video segments directly inside your browser tab without server uploads.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.enableWasmMuxing}
                    onClick={() => updateSettings('enableWasmMuxing', !settings.enableWasmMuxing)}
                    className={`relative w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet ${
                      settings.enableWasmMuxing ? 'bg-brand-violet' : 'bg-line-hover'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white shadow-xs transform transition-transform ${
                        settings.enableWasmMuxing ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </section>
            )}

            {/* ═════════ TAB: INSTANCES ═════════ */}
            {activeTab === 'instances' && (
              <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-card space-y-6">
                <div>
                  <h2 className="text-base font-bold text-content">Custom Media Worker Fleet (BYO-Worker)</h2>
                  <p className="text-xs text-content-secondary mt-0.5">
                    Connect a self-hosted Docker media worker (running on Oracle Cloud Always Free, Render, or a VPS) to bypass cloud datacenter limits.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="custom-worker-input"
                      className="block text-xs font-semibold text-content mb-1.5"
                    >
                      Worker API Endpoint URL
                    </label>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                      <input
                        id="custom-worker-input"
                        type="url"
                        value={customWorkerInput}
                        onChange={(e) => setCustomWorkerInput(e.target.value)}
                        placeholder="e.g. http://localhost:5001 or https://worker.yourdomain.com"
                        className="flex-1 px-4 py-2.5 rounded-xl border border-line bg-surface-elevated text-content text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={testingWorker}
                          onClick={handleWorkerTest}
                          className="px-4 py-2.5 rounded-xl border border-line bg-surface hover:bg-surface-elevated text-xs font-semibold text-content transition-colors disabled:opacity-50"
                        >
                          {testingWorker ? 'Testing…' : 'Test Endpoint'}
                        </button>
                        <button
                          type="button"
                          onClick={handleWorkerSave}
                          className="muxaro-btn-primary px-5 py-2.5 text-xs font-bold inline-flex items-center gap-1.5 rounded-xl"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{saveWorkerFeedback ? 'Saved!' : 'Save'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {workerTestResult && (
                    <div
                      className={`p-4 rounded-xl border text-xs flex items-start gap-2.5 ${
                        workerTestResult.success
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {workerTestResult.success ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      )}
                      <div className="leading-relaxed">{workerTestResult.message}</div>
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-between text-xs text-content-secondary border-t border-line/60">
                    <span>Default: Same-origin Vercel Serverless Gateway (`/api/v1`)</span>
                    <button
                      type="button"
                      onClick={handleWorkerReset}
                      className="hover:text-content font-medium underline transition-colors"
                    >
                      Reset to Default
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ═════════ TAB: PRIVACY ═════════ */}
            {activeTab === 'privacy' && (
              <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-card space-y-6">
                <div>
                  <h2 className="text-base font-bold text-content">Privacy &amp; Local Storage</h2>
                  <p className="text-xs text-content-secondary mt-0.5">
                    MUXARO enforces strict ephemeral pipelines with zero tracking or user profiling.
                  </p>
                </div>

                <div className="p-5 rounded-xl bg-surface-elevated border border-line space-y-3">
                  <p className="text-xs text-content-secondary leading-relaxed">
                    MUXARO does not store search histories, log user IP addresses, or retain media files beyond 60 minutes. Stream copy jobs run entirely in RAM or through signed short-lived Cloudflare R2 bucket URLs.
                  </p>
                  <div className="pt-3 border-t border-line/60 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-content">Clear Local Browser Data</div>
                      <div className="text-xs text-content-secondary mt-0.5">
                        Deletes saved download history and local temporary cache from this browser.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearLocalData}
                      className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{clearedDataFeedback ? 'Cleared!' : 'Clear Data'}</span>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ═════════ TAB: ADVANCED ═════════ */}
            {activeTab === 'advanced' && (
              <section className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-card space-y-6">
                <div>
                  <h2 className="text-base font-bold text-content">Network &amp; Buffer Tuning</h2>
                  <p className="text-xs text-content-secondary mt-0.5">
                    Advanced streaming thresholds and timeout parameters.
                  </p>
                </div>

                {/* Chunk Size */}
                <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-content">Stream Buffer Chunk Size</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Memory allocated per progressive streaming chunk.
                    </div>
                  </div>
                  <div className="relative">
                    <select
                      value={settings.streamChunkSize}
                      onChange={(e) => updateSettings('streamChunkSize', e.target.value as StreamChunkSize)}
                      className="appearance-none bg-surface border border-line rounded-lg text-sm text-content font-medium pr-8 pl-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-violet cursor-pointer"
                    >
                      <option value="1">1 MB (Low Memory)</option>
                      <option value="4">4 MB (Default)</option>
                      <option value="8">8 MB (High Speed)</option>
                      <option value="16">16 MB (Gigabit)</option>
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-content-secondary absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* Request Timeout */}
                <div className="p-4 rounded-xl bg-surface-elevated border border-line flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-content">Media Probe Timeout</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Maximum duration allowed for upstream format inspection.
                    </div>
                  </div>
                  <div className="relative">
                    <select
                      value={settings.requestTimeout}
                      onChange={(e) => updateSettings('requestTimeout', e.target.value as RequestTimeout)}
                      className="appearance-none bg-surface border border-line rounded-lg text-sm text-content font-medium pr-8 pl-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-violet cursor-pointer"
                    >
                      <option value="30">30 seconds</option>
                      <option value="60">60 seconds (Default)</option>
                      <option value="120">120 seconds</option>
                      <option value="300">300 seconds</option>
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-content-secondary absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* Reset to defaults */}
                <div className="pt-4 border-t border-line/60 flex items-center justify-between">
                  <span className="text-xs text-content-secondary">Restore all user preferences to default values</span>
                  <button
                    type="button"
                    onClick={resetSettings}
                    className="inline-flex items-center gap-1.5 text-xs text-content-secondary hover:text-content transition-colors font-medium"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset to Defaults</span>
                  </button>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
