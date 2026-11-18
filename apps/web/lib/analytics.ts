'use client';

export const CONSENT_STORAGE_KEY = 'muxaro-consent-v2';
export const CONSENT_CHANGE_EVENT = 'muxaro-consent-change';
export const OPEN_CONSENT_EVENT = 'muxaro-open-consent-settings';

export const GA_MEASUREMENT_ID = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '').trim();
export const GTM_CONTAINER_ID = (process.env.NEXT_PUBLIC_GTM_CONTAINER_ID ?? '').trim();

export interface ConsentPreferences {
  version: 2;
  decided: boolean;
  analytics: boolean;
  rewardedAds: boolean;
  updatedAt: string;
}

export type AnalyticsEventName =
  // Acquisition
  | 'page_view'
  | 'cta_clicked'
  | 'tool_opened'
  // Auth
  | 'auth_signup_started'
  | 'auth_signup_completed'
  | 'auth_login_completed'
  | 'auth_logout'
  | 'auth_email_verified'
  | 'auth_google_started'
  // Media Inspection & Upload
  | 'media_inspect_started'
  | 'media_inspect_succeeded'
  | 'media_inspect_failed'
  | 'upload_started'
  | 'upload_completed'
  | 'upload_cancelled'
  // Processing
  | 'job_created'
  | 'job_completed'
  | 'job_failed'
  | 'job_cancelled'
  | 'job_retried'
  | 'batch_created'
  // Downloads
  | 'download_started'
  | 'download_completed'
  | 'playlist_zip_downloaded'
  // Rewards
  | 'reward_prompt_viewed'
  | 'reward_session_started'
  | 'reward_verified'
  | 'reward_expired'
  | 'rewarded_ad_offer_shown'
  | 'rewarded_ad_started'
  | 'rewarded_ad_completed'
  | 'reward_granted'
  | 'rewarded_ad_unavailable'
  // Engagement
  | 'dashboard_opened'
  | 'mode_switched'
  | 'advanced_drawer_toggled'
  | 'lightweight_mode_toggled'
  | 'theme_toggled'
  | 'consent_updated';

export type SafeParamValue = string | number | boolean;
export type AnalyticsParams = Record<string, unknown>;

type GtagCommand = 'js' | 'config' | 'event' | 'set' | 'consent';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (command: GtagCommand, targetOrAction: unknown, params?: Record<string, unknown>) => void;
  }
}

const BLOCKED_KEY_PATTERN =
  /(?:^|_)(?:email|mail|name|displayname|display_name|username|user_name|url|uri|href|link|token|csrf|session|cookie|secret|password|passwd|auth|filename|file_name|filepath|file_path|path|title|ip|phone|mobile|address|user_id|userid|public_user_id|internal_user_id|subject|raw)(?:$|_)/i;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_PATTERN = /\b(?:https?:\/\/|ftp:\/\/|file:\/\/|mailto:|www\.)\S+/i;
const JWT_OR_SECRET_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.|\bBearer\s+\S+|\b[a-f0-9]{32,}\b/i;
const FILEPATH_OR_MEDIA_FILE_PATTERN =
  /[A-Za-z]:\\|\/(?:Users|home|var|tmp)\/|\.(?:mp4|mkv|webm|mov|avi|mp3|flac|wav|m4a|opus|aac|zip)\b/i;

export function isAnalyticsConfigured(): boolean {
  return GA_MEASUREMENT_ID.length > 0 || GTM_CONTAINER_ID.length > 0;
}

export function getStoredConsent(): ConsentPreferences | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentPreferences>;
    if (
      parsed &&
      parsed.version === 2 &&
      typeof parsed.decided === 'boolean' &&
      typeof parsed.analytics === 'boolean' &&
      typeof parsed.rewardedAds === 'boolean'
    ) {
      return {
        version: 2,
        decided: parsed.decided,
        analytics: parsed.analytics,
        rewardedAds: parsed.rewardedAds,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function ensureGtagShim(): void {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(window.dataLayer)) {
    window.dataLayer = [];
  }
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtagShim() {
      // Google's gtag.js reads `arguments` objects pushed into dataLayer
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
  }
}

/**
 * Sets Google Consent Mode v2 defaults (all denied) BEFORE gtag.js loads.
 */
export function applyConsentDefaults(): void {
  if (typeof window === 'undefined') return;
  ensureGtagShim();
  window.gtag?.('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500,
  });

  const existing = getStoredConsent();
  if (existing?.decided) {
    updateGtagConsent({
      analytics: existing.analytics,
      rewardedAds: existing.rewardedAds,
    });
  }
}

/**
 * Emits a Google Consent Mode v2 update signal.
 */
export function updateGtagConsent(prefs: { analytics: boolean; rewardedAds: boolean }): void {
  if (typeof window === 'undefined') return;
  ensureGtagShim();
  const analyticsState = prefs.analytics ? 'granted' : 'denied';
  const adState = prefs.rewardedAds ? 'granted' : 'denied';
  window.gtag?.('consent', 'update', {
    analytics_storage: analyticsState,
    ad_storage: adState,
    ad_user_data: adState,
    ad_personalization: adState,
  });
}

/**
 * Persists consent choice to localStorage, updates Consent Mode v2, and broadcasts sync event.
 */
export function saveConsentPreferences(prefs: {
  analytics: boolean;
  rewardedAds: boolean;
}): ConsentPreferences {
  const next: ConsentPreferences = {
    version: 2,
    decided: true,
    analytics: Boolean(prefs.analytics),
    rewardedAds: Boolean(prefs.rewardedAds),
    updatedAt: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota or private-mode errors
    }
    updateGtagConsent(next);
    window.dispatchEvent(new CustomEvent<ConsentPreferences>(CONSENT_CHANGE_EVENT, { detail: next }));
  }

  return next;
}

export function openConsentSettings(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_CONSENT_EVENT));
}

export function isAnalyticsPermitted(): boolean {
  if (!isAnalyticsConfigured()) return false;
  const stored = getStoredConsent();
  return Boolean(stored?.decided && stored.analytics);
}

/**
 * Strictly scrubs all event parameters to guarantee zero PII, emails, names,
 * raw URLs, tokens, session IDs, or local/media filenames reach GA4.
 */
export function sanitizeAnalyticsParams(params?: AnalyticsParams): Record<string, SafeParamValue> {
  if (!params || typeof params !== 'object') return {};
  const clean: Record<string, SafeParamValue> = {};

  for (const [rawKey, rawVal] of Object.entries(params)) {
    const key = rawKey.trim().toLowerCase();
    if (!key || !/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    if (BLOCKED_KEY_PATTERN.test(key)) continue;

    if (typeof rawVal === 'boolean') {
      clean[key] = rawVal;
      continue;
    }

    if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
      clean[key] = rawVal;
      continue;
    }

    if (typeof rawVal === 'string') {
      const trimmed = rawVal.trim();
      if (!trimmed) continue;
      if (
        EMAIL_PATTERN.test(trimmed) ||
        URL_PATTERN.test(trimmed) ||
        JWT_OR_SECRET_PATTERN.test(trimmed) ||
        FILEPATH_OR_MEDIA_FILE_PATTERN.test(trimmed)
      ) {
        continue;
      }
      clean[key] = trimmed.slice(0, 64);
    }
  }

  return clean;
}

/**
 * Safe GA4 event emitter. No-ops cleanly when GA4 is unconfigured or consent is denied.
 */
export function trackEvent(name: AnalyticsEventName, params?: AnalyticsParams): void {
  if (typeof window === 'undefined') return;
  if (!isAnalyticsConfigured()) return;
  if (name !== 'consent_updated' && !isAnalyticsPermitted()) return;

  ensureGtagShim();
  const safeParams = sanitizeAnalyticsParams(params);
  window.gtag?.('event', name, safeParams);
}

/**
 * Records a clean route-only page view without query strings or fragments.
 */
export function trackPageView(pathname: string): void {
  if (typeof window === 'undefined') return;
  if (!isAnalyticsPermitted()) return;

  const cleanPath = pathname.split('?')[0]?.split('#')[0] || '/';
  // Only allow safe static route segments
  const safeRoute = /^\/[a-z0-9/_-]*$/i.test(cleanPath) ? cleanPath.slice(0, 100) : '/';

  ensureGtagShim();
  window.gtag?.('event', 'page_view', {
    page_path: safeRoute,
  });
}

function isOpaqueNonPiiId(id: string): boolean {
  const trimmed = id.trim();
  if (trimmed.length < 4 || trimmed.length > 64) return false;
  if (/\s/.test(trimmed)) return false;
  if (EMAIL_PATTERN.test(trimmed) || URL_PATTERN.test(trimmed)) return false;
  return /^[a-zA-Z0-9_-]+$/.test(trimmed);
}

/**
 * Configures official GA4 `user_id` ONLY for authenticated sessions with an opaque non-PII ID.
 * Clears to `null` on logout. Never sends `user_id` as a custom event parameter.
 */
export function setAnalyticsUserId(opaqueInternalId: string | null): void {
  if (typeof window === 'undefined') return;
  if (!GA_MEASUREMENT_ID) return;

  ensureGtagShim();

  if (opaqueInternalId === null) {
    window.gtag?.('set', { user_id: null });
    window.gtag?.('config', GA_MEASUREMENT_ID, {
      user_id: null,
      send_page_view: false,
    });
    return;
  }

  if (!isOpaqueNonPiiId(opaqueInternalId)) return;

  window.gtag?.('set', { user_id: opaqueInternalId });
  window.gtag?.('config', GA_MEASUREMENT_ID, {
    user_id: opaqueInternalId,
    send_page_view: false,
  });
}
