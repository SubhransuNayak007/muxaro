/**
 * MUXARO Canonical API Error & Response Structures
 * 
 * Provides strict typing, Zod validation, and error sanitization.
 * Enforces Supreme Constitution Law 1 (Zero Hallucination) & Law 4 (Resilient Fallback):
 * - Never leak raw stack traces, Python tracebacks, or system internals.
 * - Suppress noisy red HTTP 403/429 alarms by wrapping errors into deterministic structured JSON.
 */

import { z } from 'zod';
import {
  type DeterministicStatusCode,
  statusCodeSchema,
  STATUS_HTTP_MAP,
  STATUS_MESSAGE_MAP,
} from './status-codes.js';

// =============================================================================
// 1. Zod Schemas
// =============================================================================

export const errorDetailSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  retryable: z.boolean().default(false),
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const apiErrorResponseSchema = z.object({
  ok: z.literal(false),
  success: z.literal(false),
  status: statusCodeSchema,
  error: errorDetailSchema,
  requestId: z.string(),
  timestamp: z.string(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export function createApiSuccessResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    success: z.literal(true),
    status: statusCodeSchema,
    data: dataSchema,
    requestId: z.string(),
    timestamp: z.string(),
  });
}

// =============================================================================
// 2. Sanitization & Factory Functions
// =============================================================================

/**
 * Sanitizes any unknown error, stripping stack traces, internal IP addresses,
 * and noisy HTTP 403 bot blocks into a safe, clean human-readable string.
 */
export function sanitizeErrorMessage(rawError: unknown): string {
  if (!rawError) return 'An unexpected error occurred.';
  
  let msg = '';
  if (typeof rawError === 'string') {
    msg = rawError;
  } else if (rawError instanceof Error) {
    msg = rawError.message;
  } else if (typeof rawError === 'object' && 'message' in rawError && typeof (rawError as any).message === 'string') {
    msg = (rawError as any).message;
  } else {
    msg = String(rawError);
  }

  // Strip file paths, node stack traces, python tracebacks
  msg = msg.split('\n')[0] || msg;
  msg = msg.replace(/\b(?:at\s+[\w./\\-]+|\/[\w./\\-]+|\b[A-Za-z]:\\[\w./\\-]+)/g, '').trim();

  // Strip raw bot detection / 403 noisy markers into friendly user advice
  if (/403|Forbidden|Sign in to confirm|bot|captcha|Turnstile|cloudflare/i.test(msg)) {
    return 'Upstream media source restricted cloud streaming. Direct stream handover or alternate resolution available.';
  }

  if (/429|Too Many Requests|rate limit/i.test(msg)) {
    return 'Rate limit reached. Please wait a moment before sending another request.';
  }

  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(msg)) {
    return 'Media host is currently unreachable or timing out. Please verify your connection.';
  }

  return msg.length > 200 ? `${msg.slice(0, 197)}...` : msg;
}

/**
 * Maps common runtime error patterns to canonical deterministic status codes.
 */
export function classifyErrorToStatus(err: unknown): DeterministicStatusCode {
  const str = String(err instanceof Error ? err.message : err).toLowerCase();

  if (str.includes('rate limit') || str.includes('429') || str.includes('quota')) {
    return 'rate_limited';
  }
  if (str.includes('invalid url') || str.includes('malformed') || str.includes('ssrf') || str.includes('blocked host') || str.includes('unsupported platform')) {
    return 'invalid_source';
  }
  if (str.includes('unsupported format') || str.includes('resolution not available') || str.includes('codec not supported') || str.includes('no format found')) {
    return 'format_unsupported';
  }
  if (str.includes('403') || str.includes('bot') || str.includes('forbidden') || str.includes('unavailable') || str.includes('econnrefused') || str.includes('timeout')) {
    return 'unavailable';
  }
  return 'unavailable';
}

/**
 * Creates a clean structured API error response.
 */
export function formatApiError(params: {
  status: DeterministicStatusCode;
  code?: string;
  message?: string;
  details?: unknown;
  retryable?: boolean;
  requestId?: string;
}): ApiErrorResponse {
  const status = params.status;
  const message = params.message ? sanitizeErrorMessage(params.message) : STATUS_MESSAGE_MAP[status];
  const code = params.code || status.toUpperCase();
  const requestId = params.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const timestamp = new Date().toISOString();

  return {
    ok: false,
    success: false,
    status,
    error: {
      code,
      message,
      ...(params.details !== undefined ? { details: params.details } : {}),
      retryable: params.retryable ?? (status === 'unavailable' || status === 'rate_limited'),
    },
    requestId,
    timestamp,
  };
}

/**
 * Creates a clean structured API success response.
 */
export function formatApiSuccess<T>(data: T, params?: {
  status?: DeterministicStatusCode;
  requestId?: string;
}) {
  return {
    ok: true as const,
    success: true as const,
    status: params?.status || ('ready' as DeterministicStatusCode),
    data,
    requestId: params?.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validates whether an object conforms to ApiErrorResponse.
 */
export function validateApiErrorResponse(data: unknown): {
  success: boolean;
  data?: ApiErrorResponse;
  error?: z.ZodError;
} {
  const result = apiErrorResponseSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
