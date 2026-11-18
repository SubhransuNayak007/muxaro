/**
 * Project MUXARO - Request Validation & Input Sanitization Schemas
 * 
 * Provides:
 * - Runtime request validation for all MUXARO REST API endpoints
 * - Strict length boundaries and typing (prevents buffer & memory DoS)
 * - Prototype pollution defense (strips/blocks __proto__, constructor, prototype)
 * - ReDoS-safe patterns and sanitization
 * - Domain boundaries (max playlist items = 50, duration bounds, resolution presets)
 */

export interface ValidationIssue {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationIssue[];
}

/**
 * UUIDv4 regex pattern
 */
export const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Supported container extensions
 */
export const VALID_CONTAINERS = new Set([
  'mp4',
  'webm',
  'mkv',
  'mp3',
  'm4a',
  'wav',
  'flac',
  'opus'
]);

/**
 * Supported quality targets
 */
export const VALID_QUALITIES = new Set([
  'best',
  'highest',
  '8k',
  '4k',
  '1440p',
  '1080p',
  '720p',
  '480p',
  '360p'
]);

/**
 * Check for prototype pollution payload keys
 */
export function hasPrototypePollution(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(obj, '__proto__')) return true;
  if (Object.prototype.hasOwnProperty.call(obj, 'constructor')) return true;
  if (Object.prototype.hasOwnProperty.call(obj, 'prototype')) return true;
  return false;
}

/**
 * Deep sanitize an object against prototype pollution
 */
export function sanitizeObject<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item)) as any;
  }
  const clean: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    clean[key] = sanitizeObject(value);
  }
  return clean;
}

/**
 * Validate UUID string
 */
export function validateUuid(val: unknown, fieldName = 'id'): ValidationResult<string> {
  if (typeof val !== 'string' || !UUID_V4_REGEX.test(val.trim())) {
    return {
      success: false,
      errors: [{ field: fieldName, message: `${fieldName} must be a valid UUIDv4`, code: 'INVALID_UUID' }]
    };
  }
  return { success: true, data: val.trim() };
}

/**
 * Inspect Media Request Interface
 */
export interface InspectMediaRequest {
  url: string;
}

export function validateInspectMediaRequest(body: unknown): ValidationResult<InspectMediaRequest> {
  const errors: ValidationIssue[] = [];
  if (!body || typeof body !== 'object') {
    return { success: false, errors: [{ field: 'body', message: 'Request body must be a JSON object', code: 'INVALID_BODY' }] };
  }

  const raw = body as Record<string, any>;
  if (hasPrototypePollution(raw)) {
    return { success: false, errors: [{ field: 'body', message: 'Prototype pollution attempt detected', code: 'PROTOTYPE_POLLUTION' }] };
  }

  const url = raw.url;
  if (typeof url !== 'string' || url.trim().length === 0) {
    errors.push({ field: 'url', message: 'URL is required and must be a string', code: 'REQUIRED_FIELD' });
  } else if (url.length > 2048) {
    errors.push({ field: 'url', message: 'URL exceeds maximum length of 2048 characters', code: 'MAX_LENGTH_EXCEEDED' });
  } else {
    try {
      new URL(url);
    } catch {
      errors.push({ field: 'url', message: 'Invalid URL syntax', code: 'INVALID_URL' });
    }
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: { url: (url as string).trim() } };
}

/**
 * Create Job Request Interface
 */
export interface CreateJobRequest {
  url: string;
  format?: string;
  quality?: string;
  audioOnly?: boolean;
  videoOnly?: boolean;
  startSeconds?: number;
  endSeconds?: number;
  title?: string;
  idempotencyKey?: string;
}

export function validateCreateJobRequest(body: unknown): ValidationResult<CreateJobRequest> {
  const errors: ValidationIssue[] = [];
  if (!body || typeof body !== 'object') {
    return { success: false, errors: [{ field: 'body', message: 'Request body must be a JSON object', code: 'INVALID_BODY' }] };
  }

  const raw = body as Record<string, any>;
  if (hasPrototypePollution(raw)) {
    return { success: false, errors: [{ field: 'body', message: 'Prototype pollution attempt detected', code: 'PROTOTYPE_POLLUTION' }] };
  }

  // 1. URL
  const url = raw.url;
  if (typeof url !== 'string' || url.trim().length === 0) {
    errors.push({ field: 'url', message: 'URL is required', code: 'REQUIRED_FIELD' });
  } else if (url.length > 2048) {
    errors.push({ field: 'url', message: 'URL exceeds maximum length of 2048 characters', code: 'MAX_LENGTH_EXCEEDED' });
  } else {
    try {
      new URL(url);
    } catch {
      errors.push({ field: 'url', message: 'Invalid URL syntax', code: 'INVALID_URL' });
    }
  }

  // 2. Format / Container
  let format = raw.format ? String(raw.format).toLowerCase().trim() : 'mp4';
  if (!VALID_CONTAINERS.has(format)) {
    errors.push({
      field: 'format',
      message: `Unsupported output format '${format}'. Supported: ${Array.from(VALID_CONTAINERS).join(', ')}`,
      code: 'INVALID_FORMAT'
    });
  }

  // 3. Quality Target
  let quality = raw.quality ? String(raw.quality).toLowerCase().trim() : 'best';
  if (!VALID_QUALITIES.has(quality)) {
    errors.push({
      field: 'quality',
      message: `Invalid quality target '${quality}'. Allowed: ${Array.from(VALID_QUALITIES).join(', ')}`,
      code: 'INVALID_QUALITY'
    });
  }

  // 4. Flags
  const audioOnly = Boolean(raw.audioOnly);
  const videoOnly = Boolean(raw.videoOnly);

  if (audioOnly && videoOnly) {
    errors.push({
      field: 'audioOnly',
      message: 'audioOnly and videoOnly cannot both be true simultaneously',
      code: 'CONFLICTING_FLAGS'
    });
  }

  // 5. Trimming time bounds
  let startSeconds: number | undefined;
  let endSeconds: number | undefined;

  if (raw.startSeconds !== undefined && raw.startSeconds !== null) {
    const s = Number(raw.startSeconds);
    if (Number.isNaN(s) || s < 0 || !Number.isFinite(s)) {
      errors.push({ field: 'startSeconds', message: 'startSeconds must be a non-negative number', code: 'INVALID_RANGE' });
    } else {
      startSeconds = s;
    }
  }

  if (raw.endSeconds !== undefined && raw.endSeconds !== null) {
    const e = Number(raw.endSeconds);
    if (Number.isNaN(e) || e <= 0 || !Number.isFinite(e)) {
      errors.push({ field: 'endSeconds', message: 'endSeconds must be a positive number', code: 'INVALID_RANGE' });
    } else {
      endSeconds = e;
    }
  }

  if (startSeconds !== undefined && endSeconds !== undefined && endSeconds <= startSeconds) {
    errors.push({
      field: 'endSeconds',
      message: 'endSeconds must be strictly greater than startSeconds',
      code: 'INVALID_RANGE'
    });
  }

  // Max video duration protection (14400 seconds = 4 hours)
  if (startSeconds !== undefined && endSeconds !== undefined && (endSeconds - startSeconds) > 14400) {
    errors.push({
      field: 'range',
      message: 'Requested extraction range cannot exceed 4 hours (14,400 seconds)',
      code: 'RANGE_TOO_LARGE'
    });
  }

  // 6. Title
  let title: string | undefined;
  if (raw.title !== undefined && raw.title !== null) {
    const t = String(raw.title).trim();
    if (t.length > 255) {
      errors.push({ field: 'title', message: 'Title exceeds maximum length of 255 characters', code: 'MAX_LENGTH_EXCEEDED' });
    } else {
      title = t;
    }
  }

  // 7. Idempotency Key
  let idempotencyKey: string | undefined;
  if (raw.idempotencyKey) {
    const key = String(raw.idempotencyKey).trim();
    if (key.length > 128) {
      errors.push({ field: 'idempotencyKey', message: 'Idempotency key exceeds 128 characters', code: 'MAX_LENGTH_EXCEEDED' });
    } else {
      idempotencyKey = key;
    }
  }

  if (errors.length > 0) return { success: false, errors };

  return {
    success: true,
    data: {
      url: (url as string).trim(),
      format,
      quality,
      audioOnly,
      videoOnly,
      startSeconds,
      endSeconds,
      title,
      idempotencyKey
    }
  };
}

/**
 * Merge Request Interface
 */
export interface MergeJobRequest {
  videoUrlOrId: string;
  audioUrlOrId: string;
  outputFormat?: string;
  offsetMs?: number;
  idempotencyKey?: string;
}

export function validateMergeJobRequest(body: unknown): ValidationResult<MergeJobRequest> {
  const errors: ValidationIssue[] = [];
  if (!body || typeof body !== 'object') {
    return { success: false, errors: [{ field: 'body', message: 'Request body must be a JSON object', code: 'INVALID_BODY' }] };
  }

  const raw = body as Record<string, any>;
  if (hasPrototypePollution(raw)) {
    return { success: false, errors: [{ field: 'body', message: 'Prototype pollution attempt detected', code: 'PROTOTYPE_POLLUTION' }] };
  }

  if (!raw.videoUrlOrId || typeof raw.videoUrlOrId !== 'string') {
    errors.push({ field: 'videoUrlOrId', message: 'videoUrlOrId is required', code: 'REQUIRED_FIELD' });
  }

  if (!raw.audioUrlOrId || typeof raw.audioUrlOrId !== 'string') {
    errors.push({ field: 'audioUrlOrId', message: 'audioUrlOrId is required', code: 'REQUIRED_FIELD' });
  }

  let outputFormat = raw.outputFormat ? String(raw.outputFormat).toLowerCase().trim() : 'mp4';
  if (!['mp4', 'mkv', 'webm'].includes(outputFormat)) {
    errors.push({
      field: 'outputFormat',
      message: `Invalid merge output container '${outputFormat}'. Must be mp4, mkv, or webm.`,
      code: 'INVALID_FORMAT'
    });
  }

  let offsetMs = 0;
  if (raw.offsetMs !== undefined && raw.offsetMs !== null) {
    const o = Number(raw.offsetMs);
    if (Number.isNaN(o) || Math.abs(o) > 60000) {
      errors.push({ field: 'offsetMs', message: 'offsetMs must be a number between -60000ms and +60000ms', code: 'INVALID_OFFSET' });
    } else {
      offsetMs = o;
    }
  }

  if (errors.length > 0) return { success: false, errors };

  return {
    success: true,
    data: {
      videoUrlOrId: raw.videoUrlOrId.trim(),
      audioUrlOrId: raw.audioUrlOrId.trim(),
      outputFormat,
      offsetMs,
      idempotencyKey: raw.idempotencyKey ? String(raw.idempotencyKey).trim() : undefined
    }
  };
}

/**
 * Playlist Processing Request Interface
 */
export interface CreatePlaylistJobRequest {
  url: string;
  maxItems?: number;
  itemIndices?: number[];
  format?: string;
  quality?: string;
  idempotencyKey?: string;
}

export function validatePlaylistJobRequest(body: unknown): ValidationResult<CreatePlaylistJobRequest> {
  const errors: ValidationIssue[] = [];
  if (!body || typeof body !== 'object') {
    return { success: false, errors: [{ field: 'body', message: 'Request body must be a JSON object', code: 'INVALID_BODY' }] };
  }

  const raw = body as Record<string, any>;
  if (hasPrototypePollution(raw)) {
    return { success: false, errors: [{ field: 'body', message: 'Prototype pollution attempt detected', code: 'PROTOTYPE_POLLUTION' }] };
  }

  const url = raw.url;
  if (typeof url !== 'string' || url.trim().length === 0) {
    errors.push({ field: 'url', message: 'URL is required', code: 'REQUIRED_FIELD' });
  } else if (url.length > 2048) {
    errors.push({ field: 'url', message: 'URL exceeds maximum length of 2048 characters', code: 'MAX_LENGTH_EXCEEDED' });
  }

  let maxItems = 50;
  if (raw.maxItems !== undefined && raw.maxItems !== null) {
    const m = Number(raw.maxItems);
    if (!Number.isInteger(m) || m < 1 || m > 50) {
      errors.push({ field: 'maxItems', message: 'maxItems must be an integer between 1 and 50 (PRD limit)', code: 'PLAYLIST_CAP_EXCEEDED' });
    } else {
      maxItems = m;
    }
  }

  let itemIndices: number[] | undefined;
  if (Array.isArray(raw.itemIndices)) {
    if (raw.itemIndices.length > 50) {
      errors.push({ field: 'itemIndices', message: 'Cannot select more than 50 playlist items', code: 'PLAYLIST_CAP_EXCEEDED' });
    } else if (raw.itemIndices.some(idx => !Number.isInteger(idx) || idx < 0)) {
      errors.push({ field: 'itemIndices', message: 'itemIndices must be non-negative integers', code: 'INVALID_INDICES' });
    } else {
      itemIndices = raw.itemIndices;
    }
  }

  if (errors.length > 0) return { success: false, errors };

  return {
    success: true,
    data: {
      url: (url as string).trim(),
      maxItems,
      itemIndices,
      format: raw.format ? String(raw.format).toLowerCase().trim() : 'mp4',
      quality: raw.quality ? String(raw.quality).toLowerCase().trim() : 'best',
      idempotencyKey: raw.idempotencyKey ? String(raw.idempotencyKey).trim() : undefined
    }
  };
}

/**
 * Pagination Query Validation
 */
export interface PaginationQuery {
  limit: number;
  offset: number;
}

export function validatePaginationQuery(query: any): ValidationResult<PaginationQuery> {
  const limit = query?.limit ? Number(query.limit) : 20;
  const offset = query?.offset ? Number(query.offset) : 0;

  const errors: ValidationIssue[] = [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    errors.push({ field: 'limit', message: 'limit must be an integer between 1 and 100', code: 'INVALID_PAGINATION' });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    errors.push({ field: 'offset', message: 'offset must be a non-negative integer', code: 'INVALID_PAGINATION' });
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: { limit, offset } };
}
