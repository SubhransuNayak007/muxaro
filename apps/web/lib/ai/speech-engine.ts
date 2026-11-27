'use client';

import { isCapacitorApp, isDesktopApp } from '@/lib/native-bridge';

export type VoiceLifecycleState =
  | 'not_requested'
  | 'requesting_permission'
  | 'listening'
  | 'transcribing'
  | 'ready'
  | 'denied'
  | 'unsupported'
  | 'error';

export interface VoicePackInfo {
  id: string;
  label: string;
  sizeLabel: string;
  installed: boolean;
}

export interface DesktopVoiceStatus {
  whisperReady: boolean;
  whisperBinReady: boolean;
  whisperModelId?: string | null;
  piperReady: boolean;
  sapiReady: boolean;
  modelsDir?: string;
  packs: VoicePackInfo[];
}

export interface VoiceCapabilities {
  sttSupported: boolean;
  ttsSupported: boolean;
  offlineSttReady: boolean;
  browserWhisperCached: boolean;
  reason?: string;
  platform: 'desktop-exe' | 'android-apk' | 'web';
  desktopStatus?: DesktopVoiceStatus;
  androidOnDeviceStt?: boolean;
}

export interface VoiceSessionCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (msg: string, stage?: VoiceLifecycleState) => void;
  onStateChange: (listening: boolean) => void;
  onLifecycleChange?: (stage: VoiceLifecycleState) => void;
  onLevel?: (level01: number) => void;
}

export interface VoiceSessionController {
  stop: () => void;
  finishAndTranscribe?: () => void;
}

interface SpeechRecognitionResultItem {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultItem>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

let activeAudioElement: HTMLAudioElement | null = null;
let speechQueueAborted = false;
let browserWhisperPipelinePromise: Promise<((audio: Float32Array) => Promise<string>) | null> | null = null;
let browserWhisperReady = false;

function getSpeechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Stops ALL active assistant audio/speech playback instantaneously (<20ms barge-in).
 */
export function interruptAssistantSpeech(): void {
  speechQueueAborted = true;
  if (activeAudioElement) {
    try {
      activeAudioElement.pause();
      activeAudioElement.currentTime = 0;
    } catch {}
    activeAudioElement = null;
  }
  if (isCapacitorApp()) {
    void window.Capacitor?.Plugins?.MuxaroAi?.stopSpeaking?.().catch(() => {});
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

export async function getDesktopVoiceStatus(): Promise<DesktopVoiceStatus | null> {
  if (!isDesktopApp() || !window.muxaroDesktop?.localPort) return null;
  try {
    const resp = await fetch(`http://127.0.0.1:${window.muxaroDesktop.localPort}/api/v1/ai/voice/status`, {
      cache: 'no-store',
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json?.ok ? (json.data as DesktopVoiceStatus) : null;
  } catch {
    return null;
  }
}

export async function installDesktopVoicePack(packId: string): Promise<DesktopVoiceStatus> {
  if (!isDesktopApp() || !window.muxaroDesktop?.localPort) {
    throw new Error('Desktop offline voice packs are available inside the Windows Desktop app.');
  }
  const resp = await fetch(`http://127.0.0.1:${window.muxaroDesktop.localPort}/api/v1/ai/voice/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json?.ok) {
    throw new Error(json?.error || 'Could not install voice pack.');
  }
  return json.data as DesktopVoiceStatus;
}

export async function removeDesktopVoicePack(packId: string): Promise<DesktopVoiceStatus> {
  if (!isDesktopApp() || !window.muxaroDesktop?.localPort) {
    throw new Error('Desktop runtime unavailable.');
  }
  const resp = await fetch(`http://127.0.0.1:${window.muxaroDesktop.localPort}/api/v1/ai/voice/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json?.ok) {
    throw new Error(json?.error || 'Could not remove voice pack.');
  }
  return json.data as DesktopVoiceStatus;
}

export async function getBrowserOfflineWhisper(): Promise<((audio: Float32Array) => Promise<string>) | null> {
  if (typeof window === 'undefined') return null;
  if (browserWhisperPipelinePromise) return browserWhisperPipelinePromise;

  browserWhisperPipelinePromise = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        device: hasWebGpu ? 'webgpu' : 'wasm',
        dtype: 'q8',
      });
      browserWhisperReady = true;
      return async (audio: Float32Array): Promise<string> => {
        const out = (await transcriber(audio)) as { text?: string };
        return String(out?.text || '').trim();
      };
    } catch {
      return null;
    }
  })();

  return browserWhisperPipelinePromise;
}

export async function probeVoiceCapabilities(): Promise<VoiceCapabilities> {
  const hasDesktop = isDesktopApp();
  const hasApk = isCapacitorApp();
  const speechCtor = getSpeechCtor();
  const hasBrowserTts = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const hasMicApi = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  if (hasApk) {
    let ttsSupported = hasBrowserTts;
    let sttSupported = Boolean(speechCtor);
    let androidOnDeviceStt = false;
    try {
      const caps = await window.Capacitor?.Plugins?.MuxaroAi?.getCapabilities?.();
      if (caps?.ttsReady) ttsSupported = true;
      if (caps?.speechRecognizerAvailable) sttSupported = true;
      androidOnDeviceStt = Boolean(caps?.onDeviceSttAvailable);
    } catch {}
    return {
      platform: 'android-apk',
      sttSupported,
      ttsSupported,
      offlineSttReady: androidOnDeviceStt,
      browserWhisperCached: browserWhisperReady,
      androidOnDeviceStt,
      reason: sttSupported ? undefined : 'Install Android On-Device Speech Pack or use the keyboard.',
    };
  }

  if (hasDesktop) {
    const desktopStatus = (await getDesktopVoiceStatus()) || undefined;
    const offlineSttReady = Boolean(desktopStatus?.whisperReady || browserWhisperReady);
    return {
      platform: 'desktop-exe',
      sttSupported: Boolean(hasMicApi),
      ttsSupported: true,
      offlineSttReady,
      browserWhisperCached: browserWhisperReady,
      desktopStatus,
      reason: hasMicApi ? undefined : 'Connect a microphone or switch to text input.',
    };
  }

  return {
    platform: 'web',
    sttSupported: Boolean(speechCtor || hasMicApi),
    ttsSupported: hasBrowserTts,
    offlineSttReady: browserWhisperReady,
    browserWhisperCached: browserWhisperReady,
    reason: !speechCtor && !hasMicApi ? 'Live dictation requires Chromium / Edge or MUXARO Desktop.' : undefined,
  };
}

function downsampleBuffer(buffer: Float32Array, inputRate: number, targetRate = 16000): Float32Array {
  if (inputRate === targetRate) return buffer;
  const ratio = inputRate / targetRate;
  const newLength = Math.max(1, Math.round(buffer.length / ratio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function encodeWavPcm16(samples16k: Float32Array, sampleRate = 16000): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples16k.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples16k.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples16k.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples16k.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples16k[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

async function startLocalPcmVadCapture(
  liveTalkMode: boolean,
  callbacks: VoiceSessionCallbacks,
  mode: 'desktop-whisper' | 'browser-whisper'
): Promise<VoiceSessionController> {
  callbacks.onLifecycleChange?.('requesting_permission');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const stage: VoiceLifecycleState = name === 'NotAllowedError' ? 'denied' : 'error';
    callbacks.onLifecycleChange?.(stage);
    callbacks.onStateChange(false);
    callbacks.onError(
      name === 'NotAllowedError'
        ? 'Microphone access denied. Allow mic permission in Windows Privacy or browser settings.'
        : 'No working microphone input detected.',
      stage
    );
    return { stop: () => {} };
  }

  interruptAssistantSpeech();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);

  const recorded16k: Float32Array[] = [];
  let speechDetected = false;
  let lastSpeechAt = Date.now();
  const startedAt = Date.now();
  let stopped = false;

  const cleanup = () => {
    try {
      processor.disconnect();
      source.disconnect();
    } catch {}
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };

  const transcribeCaptured = async () => {
    if (stopped) return;
    stopped = true;
    cleanup();
    callbacks.onStateChange(false);

    const joined = concatFloat32(recorded16k);
    if (!speechDetected || joined.length < 2400) {
      callbacks.onLifecycleChange?.('ready');
      callbacks.onError('No speech detected — tap the mic and speak clearly.', 'error');
      return;
    }

    callbacks.onLifecycleChange?.('transcribing');
    callbacks.onInterim('Transcribing privately on device…');
    try {
      let transcript = '';
      if (mode === 'desktop-whisper' && window.muxaroDesktop?.localPort) {
        const wavBytes = encodeWavPcm16(joined, 16000);
        const resp = await fetch(`http://127.0.0.1:${window.muxaroDesktop.localPort}/api/v1/ai/stt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64: uint8ToBase64(wavBytes), language: 'auto' }),
        });
        const json = await resp.json().catch(() => null);
        if (!resp.ok || !json?.ok) {
          throw new Error(json?.error || 'Local speech transcription failed.');
        }
        transcript = String(json.text || '').trim();
      } else {
        const fn = await getBrowserOfflineWhisper();
        if (!fn) throw new Error('In-browser offline speech engine failed to initialize.');
        transcript = await fn(joined);
      }

      callbacks.onLifecycleChange?.('ready');
      if (transcript) {
        callbacks.onFinal(transcript);
      } else {
        callbacks.onError('Could not catch any clear words — please try again.', 'error');
      }
    } catch (err) {
      callbacks.onLifecycleChange?.('error');
      callbacks.onError(err instanceof Error ? err.message : 'Offline transcription error.', 'error');
    }
  };

  processor.onaudioprocess = (ev) => {
    if (stopped) return;
    const raw = ev.inputBuffer.getChannelData(0);
    const pcm16k = downsampleBuffer(raw, ctx.sampleRate, 16000);
    recorded16k.push(pcm16k);

    let sumSq = 0;
    for (let i = 0; i < pcm16k.length; i += 1) {
      sumSq += pcm16k[i] * pcm16k[i];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, pcm16k.length));
    const normLevel = Math.min(1, rms * 11);
    callbacks.onLevel?.(normLevel);

    const now = Date.now();
    if (rms > 0.015) {
      speechDetected = true;
      lastSpeechAt = now;
    }

    if (liveTalkMode && speechDetected && now - lastSpeechAt > 1350) {
      void transcribeCaptured();
    } else if (now - startedAt > 45000) {
      void transcribeCaptured();
    }
  };

  source.connect(processor);
  processor.connect(ctx.destination);
  callbacks.onLifecycleChange?.('listening');
  callbacks.onStateChange(true);

  return {
    stop: () => {
      if (stopped) return;
      if (speechDetected) {
        void transcribeCaptured();
      } else {
        stopped = true;
        cleanup();
        callbacks.onStateChange(false);
        callbacks.onLifecycleChange?.('ready');
      }
    },
    finishAndTranscribe: () => {
      void transcribeCaptured();
    },
  };
}

export async function startVoiceCapture(
  liveTalkMode: boolean,
  callbacks: VoiceSessionCallbacks
): Promise<VoiceSessionController> {
  interruptAssistantSpeech();
  const caps = await probeVoiceCapabilities();

  // 1. Android APK -> Native Android SpeechRecognizer (createOnDeviceSpeechRecognizer / EXTRA_PREFER_OFFLINE)
  const nativePlugin = isCapacitorApp() ? window.Capacitor?.Plugins?.MuxaroAi : undefined;
  if (isCapacitorApp() && nativePlugin?.startNativeListening) {
    callbacks.onLifecycleChange?.('requesting_permission');
    const handles: Array<{ remove?: () => Promise<void> }> = [];
    let ended = false;
    const cleanupAndroid = () => {
      if (ended) return;
      ended = true;
      handles.forEach((h) => void h.remove?.().catch(() => {}));
      callbacks.onStateChange(false);
    };

    try {
      if (nativePlugin.addListener) {
        handles.push(
          await nativePlugin.addListener('voicePartial', (ev: { text?: string }) => {
            if (ev?.text) callbacks.onInterim(ev.text);
          })
        );
        handles.push(
          await nativePlugin.addListener('voiceLevel', (ev: { level?: number }) => {
            if (typeof ev?.level === 'number') callbacks.onLevel?.(ev.level);
          })
        );
        handles.push(
          await nativePlugin.addListener('voiceState', (ev: { state?: string }) => {
            if (ev?.state === 'transcribing') callbacks.onLifecycleChange?.('transcribing');
          })
        );
        handles.push(
          await nativePlugin.addListener('voiceFinal', (ev: { text?: string }) => {
            cleanupAndroid();
            callbacks.onLifecycleChange?.('ready');
            if (ev?.text?.trim()) callbacks.onFinal(ev.text.trim());
          })
        );
        handles.push(
          await nativePlugin.addListener('voiceError', (ev: { message?: string }) => {
            cleanupAndroid();
            callbacks.onLifecycleChange?.('error');
            callbacks.onError(ev?.message || 'Android voice input paused.', 'error');
          })
        );
      }

      await nativePlugin.startNativeListening({ preferOffline: true });
      callbacks.onLifecycleChange?.('listening');
      callbacks.onStateChange(true);
      return {
        stop: () => {
          void nativePlugin.stopNativeListening?.().catch(() => {});
          cleanupAndroid();
        },
      };
    } catch (err) {
      cleanupAndroid();
      const msg = err instanceof Error ? err.message : 'Unable to start Android voice capture.';
      const stage: VoiceLifecycleState = /denied|permission/i.test(msg) ? 'denied' : 'error';
      callbacks.onLifecycleChange?.(stage);
      callbacks.onError(msg, stage);
      return { stop: () => {} };
    }
  }

  // 2. Desktop EXE with Local Whisper.cpp installed -> 100% Offline 16kHz PCM + VAD -> whisper-cli.exe
  if (caps.platform === 'desktop-exe' && caps.desktopStatus?.whisperReady) {
    return startLocalPcmVadCapture(liveTalkMode, callbacks, 'desktop-whisper');
  }

  // 3. Cached In-Browser Offline Whisper (Transformers.js WebGPU / WASM)
  if (browserWhisperReady) {
    return startLocalPcmVadCapture(liveTalkMode, callbacks, 'browser-whisper');
  }

  // 4. Online Chromium SpeechRecognition fallback OR offer 1-tap Offline Voice activation
  const SpeechCtor = getSpeechCtor();
  if (!SpeechCtor) {
    if (caps.platform === 'desktop-exe') {
      callbacks.onLifecycleChange?.('unsupported');
      callbacks.onError(
        'Offline speech pack not installed yet. Open Settings -> Voice & Offline Smarts to install Fast Offline Speech (~45 MB), or switch on In-Browser Offline Voice.',
        'unsupported'
      );
      return { stop: () => {} };
    }
    callbacks.onLifecycleChange?.('unsupported');
    callbacks.onError(caps.reason || 'Voice recognition is unsupported in this browser runtime.', 'unsupported');
    return { stop: () => {} };
  }

  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    callbacks.onLifecycleChange?.('requesting_permission');
    try {
      const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      testStream.getTracks().forEach((t) => t.stop());
    } catch (permErr) {
      const name = permErr instanceof Error ? permErr.name : '';
      const stage: VoiceLifecycleState = name === 'NotAllowedError' ? 'denied' : 'error';
      callbacks.onLifecycleChange?.(stage);
      callbacks.onError('Microphone permission denied or unavailable.', stage);
      return { stop: () => {} };
    }
  }

  const rec = new SpeechCtor();
  rec.continuous = liveTalkMode;
  rec.interimResults = true;
  rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';

  let finalized = '';
  let manuallyStopped = false;

  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const item = ev.results[i];
      const txt = item[0]?.transcript || '';
      if (item.isFinal) finalized += `${txt} `;
      else interim += txt;
    }
    callbacks.onLevel?.(0.55);
    if (interim) callbacks.onInterim(`${finalized}${interim}`.trim());
    if (finalized.trim() && !interim) {
      callbacks.onFinal(finalized.trim());
      if (liveTalkMode) finalized = '';
    }
  };

  rec.onerror = (ev) => {
    if (manuallyStopped && ev?.error === 'aborted') return;
    if (ev?.error === 'network') {
      const hint =
        caps.platform === 'desktop-exe'
          ? 'Browser cloud dictation is offline. Install "Fast Offline Speech (~45 MB)" in Engine Settings for 100% offline dictation.'
          : 'Cloud dictation is unreachable offline.';
      callbacks.onLifecycleChange?.('error');
      callbacks.onStateChange(false);
      callbacks.onError(hint, 'error');
      return;
    }
    callbacks.onLifecycleChange?.('error');
    callbacks.onStateChange(false);
    callbacks.onError(ev?.message || `Voice input paused (${ev?.error || 'unknown'}).`, 'error');
  };

  rec.onend = () => {
    callbacks.onStateChange(false);
    callbacks.onLifecycleChange?.('ready');
    if (finalized.trim() && !liveTalkMode) callbacks.onFinal(finalized.trim());
  };

  try {
    rec.start();
    callbacks.onLifecycleChange?.('listening');
    callbacks.onStateChange(true);
  } catch (err) {
    callbacks.onLifecycleChange?.('error');
    callbacks.onStateChange(false);
    callbacks.onError(err instanceof Error ? err.message : 'Unable to start speech capture.', 'error');
  }

  return {
    stop: () => {
      manuallyStopped = true;
      try {
        rec.stop();
      } catch {
        try {
          rec.abort?.();
        } catch {}
      }
      callbacks.onStateChange(false);
    },
  };
}

function cleanSpeechChunks(text: string): string[] {
  const plain = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return [];
  const rawSentences = plain.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let buf = '';
  for (const s of rawSentences) {
    if ((buf + ' ' + s).trim().length > 220 && buf) {
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf = `${buf} ${s}`.trim();
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.slice(0, 6);
}

/**
 * Sentence-chunked, barge-in-interruptible assistant speech synthesizer.
 */
export async function speakAssistantConfirmation(
  text: string,
  muted: boolean,
  onSpeakingState?: (speaking: boolean) => void
): Promise<void> {
  if (muted || !text.trim()) return;
  interruptAssistantSpeech();
  speechQueueAborted = false;
  const sentences = cleanSpeechChunks(text);
  if (!sentences.length) return;

  onSpeakingState?.(true);
  try {
    // Android native sentence queue
    if (isCapacitorApp() && window.Capacitor?.Plugins?.MuxaroAi?.speakText) {
      for (let i = 0; i < sentences.length; i += 1) {
        if (speechQueueAborted) break;
        await window.Capacitor.Plugins.MuxaroAi.speakText({
          text: sentences[i],
          rate: 1.04,
          append: i > 0,
        }).catch(() => {});
      }
      return;
    }

    // Desktop Piper / Windows SAPI streamed per sentence so barge-in aborts cleanly between chunks
    if (isDesktopApp() && window.muxaroDesktop?.localPort) {
      for (const sentence of sentences) {
        if (speechQueueAborted) break;
        const resp = await fetch(`http://127.0.0.1:${window.muxaroDesktop.localPort}/api/v1/ai/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sentence }),
        });
        if (!resp.ok || speechQueueAborted) continue;
        const blob = await resp.blob();
        if (speechQueueAborted) break;
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          activeAudioElement = audio;
          const done = () => {
            URL.revokeObjectURL(url);
            if (activeAudioElement === audio) activeAudioElement = null;
            resolve();
          };
          audio.onended = done;
          audio.onerror = done;
          audio.onpause = () => {
            if (speechQueueAborted) done();
          };
          void audio.play().catch(done);
        });
      }
      return;
    }

    // Standard browser Web Speech fallback
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      for (const sentence of sentences) {
        if (speechQueueAborted) break;
        await new Promise<void>((resolve) => {
          const utter = new SpeechSynthesisUtterance(sentence);
          utter.rate = 1.04;
          utter.onend = () => resolve();
          utter.onerror = () => resolve();
          window.speechSynthesis.speak(utter);
        });
      }
    }
  } finally {
    onSpeakingState?.(false);
  }
}
