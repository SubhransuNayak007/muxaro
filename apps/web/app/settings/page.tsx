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
  Sparkles,
  Cpu,
  KeyRound,
  Brain,
  Plug,
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
import {
  clearAllLearnedSkills,
  clearAllMemoryRules,
  DEFAULT_AI_V3_SETTINGS,
  deleteLearnedSkill,
  deleteMemoryRule,
  discoverMcpToolsWithPinning,
  ensureWebGpuEngine,
  hasClientByokKeySync,
  listLearnedSkills,
  listMemoryRules,
  loadAiV3Settings,
  probeWebGpuAvailability,
  PROVIDER_DEFAULT_MODELS,
  purgeWebGpuCache,
  saveAiV3Settings,
  saveClientByokKey,
  toggleMemoryRule,
  WEBGPU_RECOMMENDED_MODELS,
  type AiProviderId,
  type AiRuntimePreference,
  type EpisodicMemoryRule,
  type KeyPersistenceMode,
  type LearnedSkillRecipe,
  type MuxaroAiV3Settings,
  type WebGpuAvailability,
} from '@/lib/ai';

type SettingsTab = 'appearance' | 'downloads' | 'ai' | 'worker';

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

  // AI & Memory v3 state
  const [aiSettings, setAiSettings] = useState<MuxaroAiV3Settings>(DEFAULT_AI_V3_SETTINGS);
  const [byokInput, setByokInput] = useState<string>('');
  const [hasStoredKey, setHasStoredKey] = useState<boolean>(false);
  const [aiSavedNote, setAiSavedNote] = useState<string | null>(null);
  const [webgpuInfo, setWebgpuInfo] = useState<WebGpuAvailability | null>(null);
  const [webgpuLoadStatus, setWebgpuLoadStatus] = useState<string | null>(null);
  const [memoryRules, setMemoryRules] = useState<EpisodicMemoryRule[]>([]);
  const [learnedSkills, setLearnedSkills] = useState<LearnedSkillRecipe[]>([]);
  const [mcpNameInput, setMcpNameInput] = useState<string>('');
  const [mcpUrlInput, setMcpUrlInput] = useState<string>('');
  const [mcpStatus, setMcpStatus] = useState<string | null>(null);

  const reloadAiPanels = () => {
    setAiSettings(loadAiV3Settings());
    setHasStoredKey(hasClientByokKeySync());
    setMemoryRules(listMemoryRules());
    setLearnedSkills(listLearnedSkills());
    void probeWebGpuAvailability().then(setWebgpuInfo).catch(() => {});
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('muxaro-auto-download');
      setAutoDownload(stored === null ? true : getAutoDownloadPreference());
      reloadAiPanels();

      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab === 'downloads' || tab === 'video' || tab === 'audio') setActiveTab('downloads');
      else if (tab === 'ai' || tab === 'memory' || tab === 'models') setActiveTab('ai');
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
    { id: 'ai', label: 'AI & Memory', Icon: Sparkles },
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

        {/* Tab 3: AI & Memory (WebGPU, BYOK, Voyager Skills, Dreaming Memory & MCP) */}
        {activeTab === 'ai' && (
          <div className="space-y-6">
            {/* Engine Mode & BYOK Keys */}
            <div className="muxaro-card p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-content flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-brand" aria-hidden="true" />
                    <span>Inference Engine &amp; API Key (BYOK)</span>
                  </h2>
                  <p className="text-xs text-content-secondary mt-1">
                    Choose free local Browser WebGPU, Desktop Ollama, or your own API key streamed over SSE. Keys are never logged on our servers.
                  </p>
                </div>
                {hasStoredKey && (
                  <span className="px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    Key active ({aiSettings.provider})
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-content-secondary mb-1.5">
                    Runtime Priority
                  </label>
                  <select
                    value={aiSettings.runtimePreference}
                    onChange={(e) => {
                      const next = {
                        ...aiSettings,
                        runtimePreference: e.target.value as AiRuntimePreference,
                      };
                      setAiSettings(next);
                      saveAiV3Settings(next);
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-line bg-base text-xs font-medium text-content"
                  >
                    <option value="auto">Auto Smart Routing</option>
                    <option value="webgpu-local">WebGPU Local (Free On-Device)</option>
                    <option value="byok-cloud">Cloud BYOK (Frontier Models)</option>
                    <option value="desktop-ollama">Desktop Ollama / LM Studio</option>
                    <option value="tier0-offline">Deterministic Tier-0 Only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-content-secondary mb-1.5">
                    Cloud Provider
                  </label>
                  <select
                    value={aiSettings.provider}
                    onChange={(e) => {
                      const prov = e.target.value as AiProviderId;
                      const next = {
                        ...aiSettings,
                        provider: prov,
                        model: PROVIDER_DEFAULT_MODELS[prov][0],
                      };
                      setAiSettings(next);
                      saveAiV3Settings(next);
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-line bg-base text-xs font-medium text-content"
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI (GPT / o3-mini)</option>
                    <option value="anthropic">Anthropic Claude</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="groq">Groq</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-content-secondary mb-1.5">
                    Model ID
                  </label>
                  <input
                    type="text"
                    value={aiSettings.model}
                    onChange={(e) => {
                      const next = { ...aiSettings, model: e.target.value };
                      setAiSettings(next);
                      saveAiV3Settings(next);
                    }}
                    placeholder={PROVIDER_DEFAULT_MODELS[aiSettings.provider][0]}
                    className="w-full px-3 py-2.5 rounded-xl border border-line bg-base text-xs font-mono text-content"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-content-secondary mb-1.5">
                    API Key (Optional · Overrides server fallback)
                  </label>
                  <input
                    type="password"
                    value={byokInput}
                    onChange={(e) => setByokInput(e.target.value)}
                    placeholder={hasStoredKey ? 'Saved key active — enter new key to replace' : 'Paste Gemini / OpenAI / Anthropic / Groq key'}
                    className="w-full px-3 py-2.5 rounded-xl border border-line bg-base text-xs font-mono text-content"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-content-secondary mb-1.5">
                    Key Storage
                  </label>
                  <select
                    value={aiSettings.keyPersistence}
                    onChange={(e) => {
                      const next = {
                        ...aiSettings,
                        keyPersistence: e.target.value as KeyPersistenceMode,
                      };
                      setAiSettings(next);
                      saveAiV3Settings(next);
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-line bg-base text-xs font-medium text-content"
                  >
                    <option value="session">This tab session only</option>
                    <option value="device-encrypted">Encrypted local device (AES-GCM)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await saveClientByokKey(aiSettings.provider, byokInput, aiSettings.keyPersistence);
                    setByokInput('');
                    setHasStoredKey(hasClientByokKeySync());
                    setAiSavedNote('AI key preferences updated cleanly.');
                    setTimeout(() => setAiSavedNote(null), 2200);
                  }}
                  className="px-4 py-2 rounded-xl bg-brand text-brand-fg text-xs font-semibold hover:bg-brand-hover"
                >
                  Save API Key
                </button>
                {hasStoredKey && (
                  <button
                    type="button"
                    onClick={async () => {
                      await saveClientByokKey(aiSettings.provider, '', 'session');
                      setHasStoredKey(false);
                      setAiSavedNote('Cleared API key from device.');
                      setTimeout(() => setAiSavedNote(null), 2200);
                    }}
                    className="px-3.5 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content-secondary hover:text-error"
                  >
                    Remove Key
                  </button>
                )}
                {aiSavedNote && <span className="text-xs text-emerald-600 dark:text-emerald-400">{aiSavedNote}</span>}
              </div>
            </div>

            {/* Browser WebGPU Local SLM */}
            <div className="muxaro-card p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-content flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-brand" aria-hidden="true" />
                    <span>Browser WebGPU Local Models</span>
                  </h2>
                  <p className="text-xs text-content-secondary mt-1">
                    {webgpuInfo?.supported
                      ? `WebGPU ready (${webgpuInfo.adapterDescription || 'GPU Adapter'}). Runs private quantized models inside your browser.`
                      : webgpuInfo?.reason || 'Checking browser WebGPU support…'}
                  </p>
                </div>
                {webgpuInfo && webgpuInfo.cachedModels.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-surface-elevated border border-line text-[11px] font-mono text-content">
                    Cached locally
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {WEBGPU_RECOMMENDED_MODELS.map((m) => {
                  const selected = aiSettings.webgpuModelId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        const next = { ...aiSettings, webgpuModelId: m.id };
                        setAiSettings(next);
                        saveAiV3Settings(next);
                      }}
                      className={`p-3 rounded-xl border text-left space-y-1 transition-colors ${
                        selected
                          ? 'border-brand bg-brand/8'
                          : 'border-line bg-base hover:border-line-hover'
                      }`}
                    >
                      <div className="text-xs font-semibold text-content">{m.label}</div>
                      <div className="text-[11px] text-content-secondary leading-snug">{m.notes}</div>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!webgpuInfo?.supported}
                  onClick={async () => {
                    setWebgpuLoadStatus('Starting WebGPU weight download…');
                    try {
                      await ensureWebGpuEngine(aiSettings.webgpuModelId, (p) =>
                        setWebgpuLoadStatus(`${p.progressPct}% — ${p.text}`)
                      );
                      setWebgpuLoadStatus('WebGPU model loaded and ready in browser.');
                      reloadAiPanels();
                    } catch (err) {
                      setWebgpuLoadStatus(err instanceof Error ? err.message : 'WebGPU load failed.');
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-content text-base text-xs font-semibold disabled:opacity-45"
                >
                  Download &amp; Warm Selected Model
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await purgeWebGpuCache();
                    setWebgpuLoadStatus('Cleared WebGPU model cache from browser storage.');
                    reloadAiPanels();
                  }}
                  className="px-3.5 py-2 rounded-xl border border-line bg-surface-elevated text-xs font-medium text-content-secondary hover:text-content"
                >
                  Purge WebGPU Cache
                </button>
                {webgpuLoadStatus && <span className="text-xs text-content-secondary">{webgpuLoadStatus}</span>}
              </div>
            </div>

            {/* Dreaming Memory & Voyager Skills */}
            <div className="muxaro-card p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-content flex items-center gap-2">
                    <Brain className="w-4 h-4 text-brand" aria-hidden="true" />
                    <span>Learned Skills &amp; Dreaming Memory</span>
                  </h2>
                  <p className="text-xs text-content-secondary mt-1">
                    Verified reusable workflows and preferences stored privately on this device. Inspect or delete anything anytime.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      clearAllMemoryRules();
                      clearAllLearnedSkills();
                      reloadAiPanels();
                    }}
                    className="px-3 py-1.5 rounded-xl border border-line text-xs font-medium text-content-secondary hover:text-error"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-content">
                    Memory Rules ({memoryRules.length})
                  </div>
                  {memoryRules.length === 0 ? (
                    <p className="text-xs text-content-secondary p-3 rounded-xl border border-line bg-base">
                      No episodic preferences learned yet.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {memoryRules.map((rule) => (
                        <div
                          key={rule.id}
                          className="p-2.5 rounded-xl border border-line bg-base flex items-center justify-between gap-2 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              toggleMemoryRule(rule.id);
                              reloadAiPanels();
                            }}
                            className={`flex-1 text-left truncate ${rule.enabled ? 'text-content' : 'line-through text-content-tertiary'}`}
                          >
                            {rule.ruleText}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              deleteMemoryRule(rule.id);
                              reloadAiPanels();
                            }}
                            aria-label="Delete rule"
                            className="p-1 text-content-tertiary hover:text-error"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-content">
                    Verified Skill Library ({learnedSkills.length})
                  </div>
                  {learnedSkills.length === 0 ? (
                    <p className="text-xs text-content-secondary p-3 rounded-xl border border-line bg-base">
                      No verified multi-step skills saved yet.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {learnedSkills.map((sk) => (
                        <div
                          key={sk.id}
                          className="p-2.5 rounded-xl border border-line bg-base flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-content truncate">{sk.intentSummary}</div>
                            <div className="text-[11px] text-content-secondary">
                              {sk.domain} · {sk.verifiedPassCount} pass / {sk.failCount} fail
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              deleteLearnedSkill(sk.id);
                              reloadAiPanels();
                            }}
                            aria-label="Delete skill"
                            className="p-1 text-content-tertiary hover:text-error"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* External MCP Servers (Spec 2026-07-28) */}
            <div className="muxaro-card p-6 space-y-4">
              <div>
                <h2 className="text-base font-bold text-content flex items-center gap-2">
                  <Plug className="w-4 h-4 text-brand" aria-hidden="true" />
                  <span>External MCP Servers (Schema-Pinned)</span>
                </h2>
                <p className="text-xs text-content-secondary mt-1">
                  Connect Streamable HTTP MCP endpoints via SSRF-guarded relay with SHA-256 rug-pull detection.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={mcpNameInput}
                  onChange={(e) => setMcpNameInput(e.target.value)}
                  placeholder="Server label (e.g. Docs)"
                  className="px-3 py-2 rounded-xl border border-line bg-base text-xs text-content sm:w-44"
                />
                <input
                  type="url"
                  value={mcpUrlInput}
                  onChange={(e) => setMcpUrlInput(e.target.value)}
                  placeholder="https://your-mcp-server.example/mcp"
                  className="flex-1 px-3 py-2 rounded-xl border border-line bg-base text-xs font-mono text-content"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const url = mcpUrlInput.trim();
                    const name = mcpNameInput.trim() || 'MCP Server';
                    if (!url) return;
                    setMcpStatus('Inspecting & pinning tool schemas…');
                    try {
                      const res = await discoverMcpToolsWithPinning(url, {});
                      const entry = {
                        id: `mcp-${Date.now()}`,
                        name,
                        url,
                        enabled: true,
                        pinnedToolHashes: res.updatedPins,
                      };
                      const next = { ...aiSettings, mcpServers: [...aiSettings.mcpServers, entry] };
                      setAiSettings(next);
                      saveAiV3Settings(next);
                      setMcpNameInput('');
                      setMcpUrlInput('');
                      setMcpStatus(`Pinned ${res.tools.length} tool(s). ${res.rugPullWarnings[0] || ''}`);
                    } catch (err) {
                      setMcpStatus(err instanceof Error ? err.message : 'Failed to connect MCP server.');
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-brand text-brand-fg text-xs font-semibold shrink-0"
                >
                  Connect &amp; Pin
                </button>
              </div>
              {mcpStatus && <div className="text-xs text-content-secondary">{mcpStatus}</div>}
              {aiSettings.mcpServers.length > 0 && (
                <div className="space-y-1.5">
                  {aiSettings.mcpServers.map((srv) => (
                    <div
                      key={srv.id}
                      className="p-2.5 rounded-xl border border-line bg-base flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-content truncate">{srv.name}</div>
                        <div className="text-[11px] font-mono text-content-secondary truncate">{srv.url}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = {
                            ...aiSettings,
                            mcpServers: aiSettings.mcpServers.filter((x) => x.id !== srv.id),
                          };
                          setAiSettings(next);
                          saveAiV3Settings(next);
                        }}
                        className="p-1 text-content-tertiary hover:text-error"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Worker & Data */}
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
