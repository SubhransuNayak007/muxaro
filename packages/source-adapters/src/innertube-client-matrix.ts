/**
 * Project Garuda - YouTube Innertube Multi-Client Fallback Matrix
 * 
 * Implements the multi-client fallback hierarchy:
 * 1. TVHTML5_SIMPLY_EMBEDDED: Highest reliability, no SABR, no PoToken required, clear direct URLs
 * 2. IOS: Unthrottled mobile streaming streams, high bitrate Opus/AAC
 * 3. ANDROID: High fidelity VP9/AV1 tables, Android client context
 * 4. WEB: Standard desktop browser client (with PoToken attestation if available)
 * 5. WEB_EMBEDDED: Lightweight embedded web player
 * 
 * Features:
 * - Deterministic client switching on LOGIN_REQUIRED or SABR errors
 * - SAPISIDHASH signature generator for authenticated sessions
 * - Complete headers, clientName IDs, and context payloads
 */

import { createHash } from 'node:crypto';

export interface InnertubeClientProfile {
  name: string;
  clientNameId: string;
  clientName: string;
  clientVersion: string;
  platform: string;
  clientScreen?: string;
  userAgent: string;
  headers: Record<string, string>;
  innertubeContext: Record<string, unknown>;
  supportsSabr: boolean;
  requiresPoToken: boolean;
}

export interface InnertubeRequestOptions {
  videoId: string;
  poToken?: string;
  visitorData?: string;
  signatureTimestamp?: number;
  sapisid?: string;
  cookies?: string;
  origin?: string;
}

export interface InnertubeClientExecutionResult {
  profile: InnertubeClientProfile;
  statusCode: number;
  playabilityStatus?: {
    status: string;
    reason?: string;
    errorScreen?: unknown;
  };
  streamingData?: {
    formats?: unknown[];
    adaptiveFormats?: unknown[];
    hlsManifestUrl?: string;
    dashManifestUrl?: string;
    serverAbrStreamingUrl?: string;
  };
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: string;
    author: string;
    channelId: string;
    viewCount?: string;
    isLiveContent?: boolean;
  };
  rawResponse: Record<string, unknown>;
}

/**
 * Pre-configured client profiles representing YouTube's diverse client ecosystem
 */
export const INNERTUBE_CLIENT_PROFILES: readonly InnertubeClientProfile[] = [
  // 1. TVHTML5_SIMPLY_EMBEDDED (Smart TV / Embed) - Lowest hostility, no SABR, clear direct URLs
  {
    name: 'TVHTML5_SIMPLY_EMBEDDED',
    clientNameId: '85',
    clientName: 'TVHTML5_SIMPLY_EMBEDDED',
    clientVersion: '2.0',
    platform: 'TV',
    clientScreen: 'EMBED',
    userAgent:
      'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1',
      'X-YouTube-Client-Name': '85',
      'X-YouTube-Client-Version': '2.0',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/tv',
    },
    innertubeContext: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED',
        clientVersion: '2.0',
        clientScreen: 'EMBED',
        platform: 'TV',
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com',
      },
    },
    supportsSabr: false,
    requiresPoToken: false,
  },

  // 2. IOS (iOS Native App) - High fidelity, low SABR enforcement, clean DASH streams
  {
    name: 'IOS',
    clientNameId: '5',
    clientName: 'IOS',
    clientVersion: '19.45.4',
    platform: 'MOBILE',
    userAgent:
      'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
    headers: {
      'User-Agent':
        'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
      'X-YouTube-Client-Name': '5',
      'X-YouTube-Client-Version': '19.45.4',
      Origin: 'https://www.youtube.com',
    },
    innertubeContext: {
      client: {
        clientName: 'IOS',
        clientVersion: '19.45.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iOS',
        osVersion: '17.5.1.21F90',
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
    },
    supportsSabr: false,
    requiresPoToken: false,
  },

  // 3. ANDROID (Android Native App) - Full VP9/AV1 profile tables
  {
    name: 'ANDROID',
    clientNameId: '3',
    clientName: 'ANDROID',
    clientVersion: '19.44.38',
    platform: 'MOBILE',
    userAgent:
      'com.google.android.youtube/19.44.38 (Linux; U; Android 14; en_US; Pixel 8 Pro Build/UD1A.230803.041)',
    headers: {
      'User-Agent':
        'com.google.android.youtube/19.44.38 (Linux; U; Android 14; en_US; Pixel 8 Pro Build/UD1A.230803.041)',
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': '19.44.38',
      Origin: 'https://www.youtube.com',
    },
    innertubeContext: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.44.38',
        deviceMake: 'Google',
        deviceModel: 'Pixel 8 Pro',
        osName: 'Android',
        osVersion: '14',
        androidSdkVersion: 34,
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
    },
    supportsSabr: true,
    requiresPoToken: false,
  },

  // 4. WEB (Desktop Web Client) - Complete format table; requires PoToken on datacenter IPs
  {
    name: 'WEB',
    clientNameId: '1',
    clientName: 'WEB',
    clientVersion: '2.20241118.01.00',
    platform: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20241118.01.00',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
    },
    innertubeContext: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20241118.01.00',
        platform: 'DESKTOP',
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
    },
    supportsSabr: true,
    requiresPoToken: true,
  },

  // 5. WEB_EMBEDDED (Embedded Web Player)
  {
    name: 'WEB_EMBEDDED',
    clientNameId: '56',
    clientName: 'WEB_EMBEDDED',
    clientVersion: '1.20241118.01.00',
    platform: 'DESKTOP',
    clientScreen: 'EMBED',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '56',
      'X-YouTube-Client-Version': '1.20241118.01.00',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/embed/',
    },
    innertubeContext: {
      client: {
        clientName: 'WEB_EMBEDDED',
        clientVersion: '1.20241118.01.00',
        clientScreen: 'EMBED',
        platform: 'DESKTOP',
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com',
      },
    },
    supportsSabr: false,
    requiresPoToken: false,
  },
];

/**
 * Computes the SAPISIDHASH signature for authenticated YouTube requests
 * Format: "SAPISIDHASH <timestamp>_<sha1(timestamp + ' ' + sapisid + ' ' + origin)>"
 */
export function computeSapisidHash(
  sapisid: string,
  origin: string = 'https://www.youtube.com',
  timestamp: number = Math.floor(Date.now() / 1000)
): string {
  const payload = `${timestamp} ${sapisid} ${origin}`;
  const digest = createHash('sha1').update(payload).digest('hex');
  return `SAPISIDHASH ${timestamp}_${digest}`;
}

/**
 * Builds the complete HTTP POST request body for an Innertube player call
 */
export function buildPlayerRequestBody(
  profile: InnertubeClientProfile,
  options: InnertubeRequestOptions
): Record<string, unknown> {
  const context: Record<string, unknown> = JSON.parse(
    JSON.stringify(profile.innertubeContext)
  );

  const clientObj = (context.client ?? {}) as Record<string, unknown>;

  // Inject visitorData if available
  if (options.visitorData) {
    clientObj.visitorData = options.visitorData;
  }

  const body: Record<string, unknown> = {
    videoId: options.videoId,
    context: {
      ...context,
      client: clientObj,
    },
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: 'HTML5_PREF_WANTS',
        signatureTimestamp: options.signatureTimestamp ?? 19800,
      },
    },
  };

  // Inject PoToken if available
  if (options.poToken) {
    const serviceIntegrity = {
      poToken: options.poToken,
    };
    (body.playbackContext as Record<string, unknown>).serviceIntegrityDimensions = serviceIntegrity;
  }

  return body;
}

/**
 * Builds the request headers for an Innertube player call
 */
export function buildPlayerRequestHeaders(
  profile: InnertubeClientProfile,
  options: InnertubeRequestOptions
): Record<string, string> {
  const headers: Record<string, string> = {
    ...profile.headers,
    'Content-Type': 'application/json',
    Accept: '*/*',
  };

  if (options.visitorData) {
    headers['X-Goog-Visitor-Id'] = options.visitorData;
  }

  if (options.sapisid) {
    const origin = options.origin ?? profile.headers.Origin ?? 'https://www.youtube.com';
    headers['Authorization'] = computeSapisidHash(options.sapisid, origin);
  }

  if (options.cookies) {
    headers['Cookie'] = options.cookies;
  }

  return headers;
}

/**
 * Innertube Client Matrix Manager
 * Orchestrates multi-client execution, state detection, and automatic fallback
 */
export class InnertubeClientMatrix {
  private readonly profiles: readonly InnertubeClientProfile[];
  private readonly customFetch: typeof fetch;

  constructor(
    profiles: readonly InnertubeClientProfile[] = INNERTUBE_CLIENT_PROFILES,
    customFetch: typeof fetch = fetch
  ) {
    this.profiles = profiles;
    this.customFetch = customFetch;
  }

  /**
   * Retrieves all available profiles
   */
  public getProfiles(): readonly InnertubeClientProfile[] {
    return this.profiles;
  }

  /**
   * Finds a profile by name
   */
  public getProfileByName(name: string): InnertubeClientProfile | undefined {
    return this.profiles.find((p) => p.name === name);
  }

  /**
   * Executes a single Innertube request using the designated profile
   */
  public async executeClient(
    profile: InnertubeClientProfile,
    options: InnertubeRequestOptions
  ): Promise<InnertubeClientExecutionResult> {
    const endpoint = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
    const body = buildPlayerRequestBody(profile, options);
    const headers = buildPlayerRequestHeaders(profile, options);

    const res = await this.customFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const statusCode = res.status;
    let rawResponse: Record<string, unknown> = {};

    try {
      rawResponse = (await res.json()) as Record<string, unknown>;
    } catch {
      rawResponse = {};
    }

    return {
      profile,
      statusCode,
      playabilityStatus: rawResponse.playabilityStatus as InnertubeClientExecutionResult['playabilityStatus'],
      streamingData: rawResponse.streamingData as InnertubeClientExecutionResult['streamingData'],
      videoDetails: rawResponse.videoDetails as InnertubeClientExecutionResult['videoDetails'],
      rawResponse,
    };
  }

  /**
   * Runs the complete multi-client fallback pipeline.
   * Steps down through the profile matrix until a valid, non-SABR manifest is obtained.
   */
  public async executeWithFallback(
    options: InnertubeRequestOptions
  ): Promise<InnertubeClientExecutionResult> {
    const errors: Array<{ profile: string; reason: string }> = [];

    for (const profile of this.profiles) {
      try {
        const result = await this.executeClient(profile, options);
        const status = result.playabilityStatus?.status;

        // Check for success
        if (status === 'OK' && result.streamingData) {
          // If profile supports SABR, check if only UMP streams were returned
          const hasRegularFormats =
            (result.streamingData.formats && result.streamingData.formats.length > 0) ||
            (result.streamingData.adaptiveFormats && result.streamingData.adaptiveFormats.length > 0);

          if (hasRegularFormats) {
            return result;
          }
        }

        errors.push({
          profile: profile.name,
          reason: result.playabilityStatus?.reason ?? status ?? `HTTP_${result.statusCode}`,
        });
      } catch (err) {
        errors.push({
          profile: profile.name,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // If all fail, return the last error response or synthesize failure
    throw new Error(
      `Innertube fallback exhausted for video ${options.videoId}. Attempts: ${JSON.stringify(errors)}`
    );
  }
}
