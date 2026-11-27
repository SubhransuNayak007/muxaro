'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ShieldCheck, RefreshCw, AlertCircle } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/api-client';
import { isNativeAppRuntime } from '@/lib/native-bridge';

interface TurnstileApi {
  render: (
    container: HTMLElement | string,
    options: {
      sitekey: string;
      theme?: 'light' | 'dark' | 'auto';
      size?: 'normal' | 'compact' | 'flexible';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: (code?: string) => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileChallengeProps {
  /** Cloudflare Turnstile site key; defaults to NEXT_PUBLIC_TURNSTILE_SITE_KEY when set. */
  siteKey?: string;
  /** Called with the signed verification token when check passes. */
  onVerify?: (token: string) => void;
  /** Called when verification resets or expires. */
  onReset?: () => void;
  title?: string;
  subtitle?: string;
  autoVerify?: boolean;
  className?: string;
}

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function hasLeadingZeroBits(bytes: Uint8Array, bits: number): boolean {
  const fullBytes = bits >> 3;
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== 0) return false;
  }
  const rem = bits & 7;
  if (rem === 0) return true;
  return (bytes[fullBytes] >> (8 - rem)) === 0;
}

function sha256FallbackBytes(ascii: string): Uint8Array {
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i: number;
  let j: number;
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  const rightRotate = (value: number, amount: number) =>
    (value >>> amount) | (value << (32 - amount));
  for (j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash.unshift((temp1 + temp2) | 0);
      hash.pop();
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  const out = new Uint8Array(32);
  for (i = 0; i < 8; i++) {
    out[i * 4] = (hash[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (hash[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (hash[i] >>> 8) & 0xff;
    out[i * 4 + 3] = hash[i] & 0xff;
  }
  return out;
}

async function solvePowChallenge(salt: string, difficultyBits: number): Promise<string> {
  const bits = Math.min(20, Math.max(8, difficultyBits || 12));
  const subtle = typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : undefined;
  if (subtle) {
    const encoder = new TextEncoder();
    const batchSize = 64;
    for (let base = 0; base < 250000; base += batchSize) {
      const promises: Promise<ArrayBuffer>[] = [];
      for (let offset = 0; offset < batchSize; offset++) {
        promises.push(subtle.digest('SHA-256', encoder.encode(`${salt}:${base + offset}`)));
      }
      const buffers = await Promise.all(promises);
      for (let offset = 0; offset < batchSize; offset++) {
        if (hasLeadingZeroBits(new Uint8Array(buffers[offset]), bits)) {
          return String(base + offset);
        }
      }
    }
  } else {
    for (let nonce = 0; nonce < 250000; nonce++) {
      if (hasLeadingZeroBits(sha256FallbackBytes(`${salt}:${nonce}`), bits)) {
        return String(nonce);
      }
    }
  }
  throw new Error('Browser verification timed out.');
}

/**
 * Compact ~64px Enterprise Security Widget:
 * 1. Native Cloudflare Turnstile when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set.
 * 2. Silent ALTCHA-grade WebCrypto SHA-256 Proof-of-Work verification otherwise (~35ms).
 */
export default function TurnstileChallenge({
  siteKey,
  onVerify,
  onReset,
  title = 'Verify browser session',
  autoVerify = true,
  className = '',
}: TurnstileChallengeProps) {
  const resolvedSiteKey = siteKey || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const inputId = useId();
  const statusId = useId();

  const onVerifyRef = useRef(onVerify);
  const onResetRef = useRef(onReset);
  onVerifyRef.current = onVerify;
  onResetRef.current = onReset;

  const [status, setStatus] = useState<'ready' | 'verifying' | 'verified' | 'error'>('verifying');
  const [solveMs, setSolveMs] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isNativeApp, setIsNativeApp] = useState(false);

  const runPowVerification = useCallback(async () => {
    setStatus('verifying');
    setErrorText(null);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const base = getApiBaseUrl().replace(/\/+$/, '');
      const chRes = await fetch(`${base}/security/challenge`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (chRes.status === 404) {
        setStatus('verified');
        setSolveMs(0);
        onVerifyRef.current?.('local-session');
        return;
      }
      const chJson = await chRes.json().catch(() => null);
      if (!chRes.ok || !chJson?.data) {
        throw new Error('Verification service unavailable.');
      }

      if (chJson.data.alreadyVerified && chJson.data.captchaToken) {
        setStatus('verified');
        setSolveMs(0);
        onVerifyRef.current?.(chJson.data.captchaToken);
        return;
      }

      const challengeToken = String(chJson.data.challengeToken || '');
      const salt = String(chJson.data.pow?.salt || '');
      const difficultyBits = Number(chJson.data.pow?.difficultyBits || 12);
      if (!challengeToken || !salt) {
        throw new Error('Malformed verification challenge.');
      }

      const nonce = await solvePowChallenge(salt, difficultyBits);
      const verRes = await fetch(`${base}/security/verify-challenge`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ challengeToken, nonce }),
      });
      const verJson = await verRes.json();
      if (!verRes.ok || !verJson?.success || !verJson?.data?.captchaToken) {
        throw new Error(verJson?.error?.message || 'Verification failed.');
      }

      const elapsed = Math.max(
        1,
        Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
      );
      setSolveMs(elapsed);
      setStatus('verified');
      onVerifyRef.current?.(verJson.data.captchaToken);
    } catch (err: unknown) {
      setStatus('error');
      setErrorText(err instanceof Error ? err.message : 'Verification failed.');
      onResetRef.current?.();
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isNativeAppRuntime()) {
      setIsNativeApp(true);
      setStatus('verified');
      setSolveMs(0);
      onVerifyRef.current?.('native-local-verified');
      return;
    }
    let cancelled = false;

    if (!resolvedSiteKey) {
      if (autoVerify) {
        void runPowVerification();
      } else {
        setStatus('ready');
      }
      return () => {
        cancelled = true;
      };
    }

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }

      try {
        const isDark = document.documentElement.classList.contains('dark');
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: resolvedSiteKey,
          theme: isDark ? 'dark' : 'light',
          size: 'flexible',
          callback: async (cfToken: string) => {
            try {
              const base = getApiBaseUrl().replace(/\/+$/, '');
              const res = await fetch(`${base}/security/verify-challenge`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ turnstileToken: cfToken }),
              });
              const json = await res.json();
              if (res.ok && json?.data?.captchaToken) {
                setStatus('verified');
                setErrorText(null);
                onVerifyRef.current?.(json.data.captchaToken);
                return;
              }
            } catch {}
            setStatus('verified');
            onVerifyRef.current?.(cfToken);
          },
          'expired-callback': () => {
            setStatus('ready');
            onResetRef.current?.();
          },
          'error-callback': () => {
            void runPowVerification();
          },
        });
        setStatus('ready');
      } catch {
        void runPowVerification();
      }
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const existingScript = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
      const handleLoad = () => {
        if (!cancelled) renderWidget();
      };
      if (existingScript) {
        existingScript.addEventListener('load', handleLoad);
      } else {
        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.addEventListener('load', handleLoad);
        script.addEventListener('error', () => {
          if (!cancelled) void runPowVerification();
        });
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [resolvedSiteKey, autoVerify, runPowVerification]);

  const handleRetry = () => {
    setErrorText(null);
    onResetRef.current?.();
    if (resolvedSiteKey && widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
        setStatus('ready');
        return;
      } catch {}
    }
    void runPowVerification();
  };

  if (isNativeApp) {
    return null;
  }

  return (
    <div
      role="group"
      aria-label="Security verification"
      data-state={status}
      className={`rounded-xl border border-line bg-surface px-3.5 py-2.5 max-w-sm ${className}`}
    >
      {resolvedSiteKey ? (
        <div ref={containerRef} className="min-h-[64px] flex items-center" />
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative w-[22px] h-[22px] shrink-0 flex items-center justify-center">
                <input
                  id={inputId}
                  type="checkbox"
                  checked={status === 'verified'}
                  disabled={status === 'verifying'}
                  onChange={() => {
                    if (status !== 'verified') void runPowVerification();
                  }}
                  aria-describedby={statusId}
                  className={`peer appearance-none w-[22px] h-[22px] rounded-[5px] border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                    status === 'verified'
                      ? 'bg-success border-success'
                      : status === 'verifying'
                      ? 'border-transparent bg-transparent'
                      : 'border-line-hover bg-surface-elevated cursor-pointer'
                  }`}
                />
                {status === 'verifying' && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full border-2 border-brand border-b-transparent border-r-transparent motion-safe:animate-spin pointer-events-none"
                  />
                )}
                {status === 'verified' && (
                  <svg
                    viewBox="0 0 14 14"
                    aria-hidden="true"
                    className="w-3.5 h-3.5 text-white pointer-events-none absolute"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 7.5L5.5 10.5L11.5 3.5" />
                  </svg>
                )}
                {status === 'error' && (
                  <AlertCircle
                    className="w-4 h-4 text-error pointer-events-none absolute"
                    aria-hidden="true"
                  />
                )}
              </div>

              <label
                htmlFor={inputId}
                className="text-sm font-medium text-content select-none cursor-pointer truncate"
              >
                {status === 'verified'
                  ? 'Verified'
                  : status === 'verifying'
                  ? 'Verifying browser…'
                  : status === 'error'
                  ? 'Retry check'
                  : title}
              </label>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <ShieldCheck className="w-4 h-4 text-content-secondary" aria-hidden="true" />
              {status !== 'verified' && (
                <button
                  type="button"
                  onClick={handleRetry}
                  aria-label="Re-run verification check"
                  className="p-1 rounded-md text-content-secondary hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div
            id={statusId}
            aria-live="polite"
            className="flex items-center justify-between text-[11px] text-content-secondary leading-none"
          >
            <span>
              {errorText
                ? errorText
                : status === 'verified' && solveMs
                ? `SHA-256 PoW verified in ${solveMs}ms`
                : 'SHA-256 proof of work'}
            </span>
            <span className="text-content-tertiary">MUXARO Shield</span>
          </div>
        </div>
      )}
    </div>
  );
}
