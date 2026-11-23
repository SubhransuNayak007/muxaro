/**
 * MUXARO Canonical Status Codes
 * 
 * Deterministic status codes across the entire MUXARO platform (web, worker, API).
 * Prevents noisy raw HTTP error codes and uncaught exception leaks.
 */

import { z } from 'zod';

export const DETERMINISTIC_STATUS_CODES = [
  'ready',
  'processing',
  'unavailable',
  'rate_limited',
  'invalid_source',
  'format_unsupported',
] as const;

export type DeterministicStatusCode = (typeof DETERMINISTIC_STATUS_CODES)[number];

export const statusCodeSchema = z.enum(DETERMINISTIC_STATUS_CODES);

/**
 * Standard HTTP status mapping for deterministic codes.
 */
export const STATUS_HTTP_MAP: Record<DeterministicStatusCode, number> = {
  ready: 200,
  processing: 202,
  unavailable: 503,
  rate_limited: 429,
  invalid_source: 400,
  format_unsupported: 422,
};

/**
 * Clean user-facing friendly status messages designed to avoid panic or red 403 alarms.
 */
export const STATUS_MESSAGE_MAP: Record<DeterministicStatusCode, string> = {
  ready: 'Media is ready for streaming or download.',
  processing: 'Media is currently being inspected or processed.',
  unavailable: 'Upstream media source or worker service is temporarily unavailable. Try another format or check back shortly.',
  rate_limited: 'You have reached the temporary rate limit. Please wait a moment before trying again.',
  invalid_source: 'The provided link could not be verified or is not supported. Please check the URL.',
  format_unsupported: 'The selected resolution or format is not available for this media asset.',
};
