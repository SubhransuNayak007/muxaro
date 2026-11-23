/**
 * MUXARO Inspect Contract (/v1/inspect, /v1/media/inspect, /api/probe)
 * 
 * Strict schemas for inspecting media sources, returning real thumbnails,
 * verified available resolutions, duration formatting, and clean platform typing.
 */

import { z } from 'zod';
import { type DeterministicStatusCode, statusCodeSchema } from './status-codes.js';

// =============================================================================
// 1. Domain Types & Enums
// =============================================================================

export const SUPPORTED_PLATFORMS = [
  'youtube',
  'instagram',
  'tiktok',
  'x',
  'facebook',
  'reddit',
  'pinterest',
  'vimeo',
  'direct',
  'other',
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];
export const supportedPlatformSchema = z.enum(SUPPORTED_PLATFORMS);

export const RESOLUTION_TIERS = [
  '8K',
  '4K',
  '1440p',
  '1080p',
  '720p',
  '480p',
  '360p',
  '240p',
] as const;
export type ResolutionTier = (typeof RESOLUTION_TIERS)[number] | (string & {});

// =============================================================================
// 2. Video & Audio Resolution Options
// =============================================================================

export const videoResolutionOptionSchema = z.object({
  id: z.string().min(1),
  formatId: z.string().min(1),
  pairedAudioFormatId: z.string().optional(),
  label: z.string().min(1), // e.g. "1080p Full HD", "4K Ultra HD"
  resolution: z.string().min(1), // e.g. "1080p", "4K"
  height: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  fps: z.number().positive().default(30),
  vcodec: z.string().default('h264'),
  acodec: z.string().optional(),
  container: z.string().default('mp4'),
  targetContainer: z.string().default('mp4'),
  filesize: z.number().int().nonnegative().optional(),
  bitrateKbps: z.number().nonnegative().optional(),
  isHdr: z.boolean().default(false),
  requiresMerge: z.boolean().default(false),
  badge: z.string().optional(), // e.g. "60fps", "HDR", "Best"
});
export type VideoResolutionOption = z.infer<typeof videoResolutionOptionSchema>;

export const audioFormatOptionSchema = z.object({
  id: z.string().min(1),
  formatId: z.string().min(1),
  label: z.string().min(1), // e.g. "MP3 320kbps", "FLAC Lossless"
  format: z.string().min(1), // "mp3" | "flac" | "wav" | "m4a" | "opus"
  bitrateKbps: z.number().int().positive(),
  bitrateLabel: z.string().min(1), // e.g. "320 kbps"
  filesize: z.number().int().nonnegative().optional(),
  acodec: z.string().optional(),
});
export type AudioFormatOption = z.infer<typeof audioFormatOptionSchema>;

export const playlistItemSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
  durationSeconds: z.number().nonnegative().optional(),
  thumbnailUrl: z.string().optional(),
});
export type PlaylistItemSummary = z.infer<typeof playlistItemSummarySchema>;

// =============================================================================
// 3. Inspect Request Contract
// =============================================================================

export const inspectRequestSchema = z.object({
  url: z.string().trim().min(1, 'Media URL is required'),
  forceRefresh: z.boolean().default(false).optional(),
  poToken: z.string().trim().optional(),
  clientSessionId: z.string().trim().optional(),
});
export type InspectRequest = z.infer<typeof inspectRequestSchema>;

// =============================================================================
// 4. Inspect Response Contract
// =============================================================================

export const inspectResponseSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string().min(1, 'Media title must not be empty'),
  thumbnailUrl: z.string().min(1, 'Real thumbnail URL is required'),
  durationSeconds: z.number().nonnegative(),
  durationFormatted: z.string().min(1), // e.g. "03:45"
  uploader: z.string().default('Unknown'),
  uploaderUrl: z.string().optional(),
  platform: supportedPlatformSchema,
  status: statusCodeSchema.default('ready'),
  availableResolutions: z.array(videoResolutionOptionSchema).default([]),
  availableAudioFormats: z.array(audioFormatOptionSchema).default([]),
  isPlaylist: z.boolean().default(false),
  playlistItems: z.array(playlistItemSummarySchema).optional(),
  deliveryMode: z.enum(['zero-hop', 'tunnel', 'worker']).default('worker').optional(),
  directStreamUrl: z.string().optional(),
  inspectedAt: z.string().datetime().or(z.string()),
});
export type InspectResponse = z.infer<typeof inspectResponseSchema>;

// =============================================================================
// 5. Helpers & Validators
// =============================================================================

/**
 * Formats duration in seconds to "MM:SS" or "HH:MM:SS"
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function validateInspectRequest(data: unknown): {
  success: boolean;
  data?: InspectRequest;
  error?: z.ZodError;
} {
  const result = inspectRequestSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}

export function validateInspectResponse(data: unknown): {
  success: boolean;
  data?: InspectResponse;
  error?: z.ZodError;
} {
  const result = inspectResponseSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}
