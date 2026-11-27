'use client';

import React from 'react';
import { Keyboard, Mic, MicOff, Volume2, VolumeX, X, Settings } from 'lucide-react';
import type { VoiceCapabilities, VoiceLifecycleState } from '@/lib/ai';

export interface VoiceOrbOverlayProps {
  open: boolean;
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
  muted: boolean;
  voiceLevel: number;
  voiceStage: VoiceLifecycleState;
  liveTranscript: string;
  lastReplyText: string;
  activeFileName?: string;
  errorText?: string | null;
  capabilities?: VoiceCapabilities | null;
  onToggleListening: () => void;
  onToggleMuted: () => void;
  onInterruptAndSpeak: () => void;
  onSwitchToKeyboard: () => void;
  onOpenVoiceSettings: () => void;
  onClose: () => void;
}

export default function VoiceOrbOverlay({
  open,
  listening,
  speaking,
  thinking,
  muted,
  voiceLevel,
  voiceStage,
  liveTranscript,
  lastReplyText,
  activeFileName,
  errorText,
  capabilities,
  onToggleListening,
  onToggleMuted,
  onInterruptAndSpeak,
  onSwitchToKeyboard,
  onOpenVoiceSettings,
  onClose,
}: VoiceOrbOverlayProps) {
  if (!open) return null;

  const scale = listening
    ? 1 + Math.min(0.28, voiceLevel * 0.34)
    : speaking
      ? 1.12
      : thinking
        ? 1.04
        : 1;

  const statusLabel = thinking
    ? 'Working…'
    : speaking
      ? 'Speaking — tap orb to interrupt'
      : voiceStage === 'transcribing'
        ? 'Transcribing offline…'
        : listening
          ? 'Listening…'
          : 'Tap mic to speak';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Speak to Work Voice Mode"
      className="fixed inset-0 z-50 bg-base/95 backdrop-blur-md flex flex-col justify-between p-5 sm:p-8"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3 max-w-2xl w-full mx-auto">
        <div className="flex items-center gap-2 min-w-0">
          {activeFileName ? (
            <span className="px-3 py-1 rounded-full border border-line bg-surface text-xs text-content-secondary truncate max-w-[260px]">
              File: <strong className="font-medium text-content">{activeFileName}</strong>
            </span>
          ) : (
            <span className="text-xs font-medium text-content-secondary">
              {capabilities?.offlineSttReady ? 'Private Voice · Ready Offline' : 'Voice Mode'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleMuted}
            aria-label={muted ? 'Unmute spoken replies' : 'Mute spoken replies'}
            className="w-9 h-9 rounded-full border border-line bg-surface text-content-secondary hover:text-content flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-brand" />}
          </button>
          <button
            type="button"
            onClick={onOpenVoiceSettings}
            aria-label="Voice & offline pack settings"
            className="w-9 h-9 rounded-full border border-line bg-surface text-content-secondary hover:text-content flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Center Pulsing Orb + Transcript */}
      <div className="flex-1 flex flex-col items-center justify-center gap-7 max-w-xl w-full mx-auto text-center px-2">
        <button
          type="button"
          onClick={speaking ? onInterruptAndSpeak : onToggleListening}
          aria-label={speaking ? 'Interrupt assistant and speak' : listening ? 'Stop listening' : 'Start speaking'}
          className="relative w-44 h-44 sm:w-52 sm:h-52 rounded-full flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {/* Ambient Soft Radial Halo (scales via transform only) */}
          <span
            aria-hidden="true"
            style={{ transform: `scale(${scale * 1.18})` }}
            className={`absolute inset-0 rounded-full blur-2xl opacity-35 transition-transform duration-150 ease-out motion-reduce:transition-none ${
              speaking ? 'bg-emerald-500/50' : 'bg-brand/45'
            }`}
          />
          {/* Core Instrument Orb */}
          <span
            aria-hidden="true"
            style={{ transform: `scale(${scale})` }}
            className={`relative w-36 h-36 sm:w-44 sm:h-44 rounded-full border border-line shadow-lg flex items-center justify-center transition-transform duration-150 ease-out motion-reduce:transition-none ${
              listening
                ? 'bg-brand/15 ring-4 ring-brand/20'
                : speaking
                  ? 'bg-emerald-500/15 ring-4 ring-emerald-500/20'
                  : 'bg-surface-elevated'
            }`}
          >
            <span className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-surface border border-line shadow-sm flex items-center justify-center">
              {listening ? (
                <Mic className="w-7 h-7 text-brand" />
              ) : speaking ? (
                <Volume2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Mic className="w-7 h-7 text-content-secondary" />
              )}
            </span>
          </span>
        </button>

        <div className="space-y-3 min-h-[5.5rem]">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-surface border border-line text-xs font-medium text-content-secondary">
            <span>{statusLabel}</span>
          </div>

          {liveTranscript ? (
            <p className="text-base sm:text-lg font-medium text-content leading-snug">
              &ldquo;{liveTranscript}&rdquo;
            </p>
          ) : lastReplyText ? (
            <p className="text-sm sm:text-base text-content-secondary leading-relaxed line-clamp-4">
              {lastReplyText}
            </p>
          ) : (
            <p className="text-sm text-content-secondary">
              Try saying: &ldquo;Shrink this video for WhatsApp&rdquo;, &ldquo;Hide my phone number&rdquo;, or &ldquo;Summarize page by page&rdquo;.
            </p>
          )}

          {errorText && (
            <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-xs text-content space-y-1.5">
              <div>{errorText}</div>
              {capabilities && !capabilities.offlineSttReady && capabilities.platform === 'desktop-exe' && (
                <button
                  type="button"
                  onClick={onOpenVoiceSettings}
                  className="text-brand font-semibold underline-offset-2 hover:underline"
                >
                  Install Offline Speech Pack in Settings
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom 3-Button Bar matching minimal Voice UX */}
      <div className="flex items-center justify-center gap-8 max-w-md w-full mx-auto pb-2">
        <button
          type="button"
          onClick={onSwitchToKeyboard}
          aria-label="Switch to keyboard"
          title="Type instead"
          className="w-11 h-11 rounded-full border border-line bg-surface text-content-secondary hover:text-content flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <Keyboard className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={speaking ? onInterruptAndSpeak : onToggleListening}
          aria-label={listening ? 'Stop microphone' : 'Start microphone'}
          className={`w-14 h-14 rounded-full border flex items-center justify-center shadow-md transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
            listening
              ? 'bg-brand border-brand text-white'
              : 'bg-surface border-line text-content hover:border-brand'
          }`}
        >
          {listening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close voice mode"
          title="Exit voice mode"
          className="w-11 h-11 rounded-full border border-line bg-surface text-content-secondary hover:text-content flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
