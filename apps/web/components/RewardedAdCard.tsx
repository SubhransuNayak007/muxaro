'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { RewardConfig, RewardSession } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { trackEvent } from '@/lib/analytics';
import { Gift, Play, RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

interface GptSlot {
  addService: (service: GptPubAdsService) => GptSlot;
  setTargeting?: (key: string, value: string | string[]) => GptSlot;
}

interface GptRewardedReadyEvent {
  slot: GptSlot;
  makeRewardedVisible: () => void;
}

interface GptRewardedEvent {
  slot: GptSlot;
}

interface GptSlotRenderEndedEvent {
  slot: GptSlot;
  isEmpty: boolean;
}

interface GptPubAdsService {
  addEventListener: (eventName: string, listener: (event: any) => void) => void;
  removeEventListener?: (eventName: string, listener: (event: any) => void) => void;
  setTargeting?: (key: string, value: string | string[]) => void;
}

interface GoogleTagApi {
  cmd: Array<() => void>;
  enums?: {
    OutOfPageFormat?: {
      REWARDED?: number | string;
    };
  };
  defineOutOfPageSlot?: (adUnitPath: string, format: number | string) => GptSlot | null;
  pubads?: () => GptPubAdsService;
  enableServices?: () => void;
  display?: (slot: GptSlot) => void;
  destroySlots?: (slots?: GptSlot[]) => boolean;
}

declare global {
  interface Window {
    googletag?: GoogleTagApi;
  }
}

export interface RewardedAdCardProps {
  /** Show a quiet muted status line on /credits when ads are unconfigured; elsewhere renders nothing. */
  showUnconfiguredNote?: boolean;
  /** Invoked ONLY after server-side verification returns status === 'VERIFIED'. */
  onRewardGranted?: () => void;
  /** Optional pre-fetched config to prevent duplicate network calls. */
  initialConfig?: RewardConfig | null;
  className?: string;
}

type RewardFlowState =
  | 'idle'
  | 'starting'
  | 'watching'
  | 'verifying'
  | 'verified'
  | 'pending_manual'
  | 'unavailable'
  | 'error';

const GPT_SCRIPT_SRC = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
const MAX_VERIFY_POLLS = 12;
const VERIFY_POLL_INTERVAL_MS = 2000;

function loadGptScript(): Promise<GoogleTagApi | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.googletag && typeof window.googletag.defineOutOfPageSlot === 'function') {
    return Promise.resolve(window.googletag);
  }

  return new Promise((resolve) => {
    window.googletag = window.googletag || { cmd: [] };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GPT_SCRIPT_SRC}"]`);

    const onReady = () => {
      if (window.googletag && Array.isArray(window.googletag.cmd)) {
        window.googletag.cmd.push(() => {
          resolve(window.googletag ?? null);
        });
      } else {
        resolve(null);
      }
    };

    const timeout = window.setTimeout(() => resolve(null), 6000);

    if (existing) {
      existing.addEventListener(
        'load',
        () => {
          window.clearTimeout(timeout);
          onReady();
        },
        { once: true }
      );
      existing.addEventListener(
        'error',
        () => {
          window.clearTimeout(timeout);
          resolve(null);
        },
        { once: true }
      );
      if (typeof window.googletag.defineOutOfPageSlot === 'function') {
        window.clearTimeout(timeout);
        onReady();
      }
      return;
    }

    const script = document.createElement('script');
    script.src = GPT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timeout);
      onReady();
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      resolve(null);
    };
    document.head.appendChild(script);
  });
}

export default function RewardedAdCard({
  showUnconfiguredNote = false,
  onRewardGranted,
  initialConfig,
  className = '',
}: RewardedAdCardProps) {
  const { authenticated, loading: authLoading } = useAuth();
  const [config, setConfig] = useState<RewardConfig | null>(initialConfig ?? null);
  const [configLoaded, setConfigLoaded] = useState<boolean>(initialConfig !== undefined);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [flowState, setFlowState] = useState<RewardFlowState>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<RewardSession | null>(null);
  const [grantedAmount, setGrantedAmount] = useState<number>(0);

  const offerTrackedRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (initialConfig !== undefined) {
      setConfig(initialConfig);
      setConfigLoaded(true);
      return;
    }

    let cancelled = false;
    api
      .getRewardConfig()
      .then((cfg) => {
        if (!cancelled) {
          setConfig(cfg);
          setConfigLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfig(null);
          setConfigLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialConfig]);

  const isConfiguredAndActive = Boolean(
    config &&
      config.enabled &&
      config.configured &&
      typeof config.adUnitPath === 'string' &&
      config.adUnitPath.trim().length > 0
  );

  const hasRemainingDailyAds = Boolean(config && config.remainingAdsToday > 0);
  const canShowOffer = authenticated && isConfiguredAndActive && hasRemainingDailyAds && !dismissed;

  useEffect(() => {
    if (canShowOffer && !offerTrackedRef.current && config) {
      offerTrackedRef.current = true;
      trackEvent('rewarded_ad_offer_shown', {
        reward_amount: config.rewardAmount,
        remaining_ads_today: config.remainingAdsToday,
      });
    }
  }, [canShowOffer, config]);

  const pollServerVerification = useCallback(
    async (sessionId: string, attempt = 1) => {
      if (!mountedRef.current) return;
      try {
        const refreshed = await api.refreshRewardSession(sessionId);
        if (!mountedRef.current) return;
        setActiveSession(refreshed);

        if (refreshed.status === 'VERIFIED') {
          const amount = refreshed.creditsGranted ?? refreshed.rewardAmount ?? config?.rewardAmount ?? 2;
          setGrantedAmount(amount);
          setFlowState('verified');
          setStatusMessage(
            `Verified! +${amount} extra video credits have been added to your balance for 24 hours.`
          );
          trackEvent('reward_granted', { reward_amount: amount });
          setConfig((prev) =>
            prev
              ? {
                  ...prev,
                  remainingAdsToday: Math.max(0, prev.remainingAdsToday - 1),
                }
              : prev
          );
          onRewardGranted?.();
          return;
        }

        if (refreshed.status === 'EXPIRED' || refreshed.status === 'REJECTED') {
          setFlowState('error');
          setStatusMessage(
            refreshed.message ||
              'This reward session expired or could not be verified by the ad provider.'
          );
          return;
        }

        if (attempt < MAX_VERIFY_POLLS) {
          pollTimerRef.current = window.setTimeout(() => {
            pollServerVerification(sessionId, attempt + 1);
          }, VERIFY_POLL_INTERVAL_MS);
        } else {
          setFlowState('pending_manual');
          setStatusMessage(
            'Waiting for confirmation from the ad provider. Your credits will appear as soon as verification finishes.'
          );
        }
      } catch (err: unknown) {
        if (!mountedRef.current) return;
        setFlowState('pending_manual');
        setStatusMessage(
          err instanceof Error
            ? err.message
            : 'Could not confirm reward status yet. You can check again in a moment.'
        );
      }
    },
    [config?.rewardAmount, onRewardGranted]
  );

  const handleManualRefresh = async () => {
    if (!activeSession?.sessionId) return;
    setFlowState('verifying');
    setStatusMessage('Checking verification status with the server...');
    await pollServerVerification(activeSession.sessionId, MAX_VERIFY_POLLS);
  };

  const handleWatchAd = async () => {
    if (!config || !isConfiguredAndActive || !config.adUnitPath) return;

    setFlowState('starting');
    setStatusMessage(null);
    trackEvent('rewarded_ad_started', { reward_amount: config.rewardAmount });

    // 1. Always create a signed server-side reward session BEFORE requesting an ad slot.
    let session: RewardSession;
    try {
      session = await api.createRewardSession();
      if (!session.sessionId) {
        throw new Error('Could not start a verified reward session.');
      }
      setActiveSession(session);
    } catch (err: unknown) {
      setFlowState('error');
      setStatusMessage(
        err instanceof Error ? err.message : 'Unable to start a reward session right now.'
      );
      return;
    }

    // 2. Load Google Publisher Tag lazily only after explicit user consent/click.
    const gpt = await loadGptScript();
    if (!mountedRef.current) return;

    const rewardedFormat = gpt?.enums?.OutOfPageFormat?.REWARDED;
    if (!gpt || typeof gpt.defineOutOfPageSlot !== 'function' || !rewardedFormat || !gpt.pubads) {
      setFlowState('unavailable');
      setStatusMessage(
        'No advertisement could be loaded right now. An ad blocker or network setting may have blocked the ad player.'
      );
      trackEvent('rewarded_ad_unavailable', { reason: 'gpt_unavailable' });
      return;
    }

    setFlowState('watching');
    let adGrantedClientSide = false;

    gpt.cmd.push(() => {
      if (!gpt.defineOutOfPageSlot || !gpt.pubads) return;
      const adUnitPath = session.adUnitPath || config.adUnitPath || '';
      const slot = gpt.defineOutOfPageSlot(adUnitPath, rewardedFormat);

      if (!slot) {
        if (mountedRef.current) {
          setFlowState('unavailable');
          setStatusMessage('Rewarded ads are not supported in this browser session.');
          trackEvent('rewarded_ad_unavailable', { reason: 'slot_unsupported' });
        }
        return;
      }

      const pubads = gpt.pubads();
      slot.addService(pubads);
      if (session.customData && typeof slot.setTargeting === 'function') {
        slot.setTargeting('muxaro_reward_custom_data', session.customData);
      }

      const cleanupSlot = () => {
        try {
          pubads.removeEventListener?.('rewardedSlotReady', onReady);
          pubads.removeEventListener?.('rewardedSlotGranted', onGranted);
          pubads.removeEventListener?.('rewardedSlotClosed', onClosed);
          pubads.removeEventListener?.('slotRenderEnded', onRenderEnded);
          gpt.destroySlots?.([slot]);
        } catch {
          // Best-effort GPT cleanup
        }
      };

      const onReady = (evt: GptRewardedReadyEvent) => {
        if (evt.slot !== slot) return;
        evt.makeRewardedVisible();
      };

      const onGranted = (evt: GptRewardedEvent) => {
        if (evt.slot !== slot) return;
        // Client event ONLY triggers server verification polling — NEVER credits locally!
        adGrantedClientSide = true;
        trackEvent('rewarded_ad_completed', { reward_amount: session.rewardAmount });
        if (mountedRef.current) {
          setFlowState('verifying');
          setStatusMessage('Advertisement finished. Verifying your reward with the server...');
        }
      };

      const onClosed = (evt: GptRewardedEvent) => {
        if (evt.slot !== slot) return;
        cleanupSlot();
        if (!mountedRef.current) return;

        if (adGrantedClientSide) {
          setFlowState('verifying');
          setStatusMessage('Verifying reward with server...');
          pollServerVerification(session.sessionId, 1);
        } else {
          setFlowState('idle');
          setStatusMessage('Advertisement was closed before finishing. No extra credits were added.');
        }
      };

      const onRenderEnded = (evt: GptSlotRenderEndedEvent) => {
        if (evt.slot !== slot) return;
        if (evt.isEmpty) {
          cleanupSlot();
          if (mountedRef.current) {
            setFlowState('unavailable');
            setStatusMessage('No advertisement is available right now. Please try again later.');
            trackEvent('rewarded_ad_unavailable', { reason: 'no_fill' });
          }
        }
      };

      pubads.addEventListener('rewardedSlotReady', onReady);
      pubads.addEventListener('rewardedSlotGranted', onGranted);
      pubads.addEventListener('rewardedSlotClosed', onClosed);
      pubads.addEventListener('slotRenderEnded', onRenderEnded);

      gpt.enableServices?.();
      gpt.display?.(slot);
    });
  };

  if (authLoading || !configLoaded || !authenticated) {
    return null;
  }

  // Strictly NEVER render a watch-ad CTA when disabled or unconfigured.
  if (!isConfiguredAndActive) {
    if (!showUnconfiguredNote) return null;
    return (
      <p className={`text-xs text-content-muted ${className}`}>
        Optional rewarded video credits are not active on this server right now.
      </p>
    );
  }

  if (!hasRemainingDailyAds && flowState !== 'verified') {
    if (!showUnconfiguredNote) return null;
    return (
      <div
        className={`muxaro-card p-4 text-xs text-content-secondary flex items-center gap-2.5 ${className}`}
      >
        <Clock className="w-4 h-4 text-content-muted shrink-0" aria-hidden="true" />
        <span>
          You have used all {config?.dailyCap ?? 3} optional rewarded ads for the current rolling
          24-hour window.
        </span>
      </div>
    );
  }

  if (dismissed) {
    return null;
  }

  const rewardAmount = config?.rewardAmount ?? 2;
  const isBusy = flowState === 'starting' || flowState === 'watching' || flowState === 'verifying';

  return (
    <aside
      aria-label="Earn extra daily credits"
      className={`muxaro-card p-5 sm:p-6 border border-line ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-md bg-elevated text-brand-indigo shrink-0">
            <Gift className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-content">
              Need {rewardAmount === 2 ? 'two' : rewardAmount} more jobs?
            </h2>
            <p className="text-xs text-content-secondary mt-1 leading-relaxed">
              Watch a short advertisement and earn {rewardAmount} extra credits. Credits expire 24
              hours after verification ({config?.remainingAdsToday ?? 0} of {config?.dailyCap ?? 3}{' '}
              offers left today).
            </p>
          </div>
        </div>

        {flowState !== 'verified' && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleWatchAd}
              disabled={isBusy}
              aria-disabled={isBusy}
              className="muxaro-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold active:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {isBusy ? (
                <RefreshCw
                  className="w-3.5 h-3.5 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>
                {flowState === 'verifying'
                  ? 'Verifying...'
                  : flowState === 'starting' || flowState === 'watching'
                  ? 'Loading ad...'
                  : 'Watch advertisement'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setDismissed(true)}
              disabled={isBusy}
              aria-disabled={isBusy}
              className="px-3 py-2 text-xs font-medium rounded-md border border-line bg-surface hover:bg-elevated active:opacity-90 text-content-secondary hover:text-content transition-colors focus-visible:outline-2 focus-visible:outline-brand-indigo disabled:opacity-50 whitespace-nowrap"
            >
              Not now
            </button>
          </div>
        )}
      </div>

      {/* Live status feedback */}
      {statusMessage && (
        <div
          role={flowState === 'error' || flowState === 'unavailable' ? 'alert' : 'status'}
          className={`mt-4 pt-3 border-t border-line-subtle flex flex-wrap items-center justify-between gap-3 text-xs ${
            flowState === 'verified'
              ? 'text-success'
              : flowState === 'error' || flowState === 'unavailable'
              ? 'text-error'
              : 'text-content-secondary'
          }`}
        >
          <div className="flex items-center gap-2">
            {flowState === 'verified' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : flowState === 'error' || flowState === 'unavailable' ? (
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : (
              <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {flowState === 'verified' && grantedAmount > 0 ? statusMessage : statusMessage}
            </span>
          </div>

          {flowState === 'pending_manual' && activeSession?.sessionId && (
            <button
              type="button"
              onClick={handleManualRefresh}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-line bg-surface hover:bg-elevated active:opacity-90 text-content font-medium transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              <span>Check status</span>
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
