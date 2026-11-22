/**
 * MUXARO Media Processing Platform - Standard Errors & MuxaroError Class
 * 
 * Centralized, strongly typed error codes, HTTP status mappings, and operational
 * error handling utilities for the entire MUXARO platform.
 */

export const MUXARO_ERROR_CODES = [
  'BAD_REQUEST',
  'INVALID_PAYLOAD',
  'INVALID_URL',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'SSRF_BLOCKED',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'IDEMPOTENCY_CONFLICT',
  'EXPIRED',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_MEDIA',
  'UNPROCESSABLE_ENTITY',
  'DRM_PROTECTED',
  'FILE_CORRUPTED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'CANCELLED',
  'INTERNAL_ERROR',
  'TRANSCODE_FAILED',
  'EXTRACTION_FAILED',
  'UPLOAD_FAILED',
  'SERVICE_UNAVAILABLE',
  'CIRCUIT_BREAKER_OPEN',
  'GATEWAY_TIMEOUT',
] as const;

export type MuxaroErrorCode = (typeof MUXARO_ERROR_CODES)[number];

export const ERROR_HTTP_STATUS_MAP: Record<MuxaroErrorCode, number> = {
  BAD_REQUEST: 400,
  INVALID_PAYLOAD: 400,
  INVALID_URL: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  SSRF_BLOCKED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  IDEMPOTENCY_CONFLICT: 409,
  EXPIRED: 410,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  UNPROCESSABLE_ENTITY: 422,
  DRM_PROTECTED: 422,
  FILE_CORRUPTED: 422,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  CANCELLED: 499,
  INTERNAL_ERROR: 500,
  TRANSCODE_FAILED: 500,
  EXTRACTION_FAILED: 502,
  UPLOAD_FAILED: 502,
  SERVICE_UNAVAILABLE: 503,
  CIRCUIT_BREAKER_OPEN: 503,
  GATEWAY_TIMEOUT: 504,
};

export interface MuxaroErrorPayload {
  readonly success: false;
  readonly error: {
    readonly code: MuxaroErrorCode;
    readonly message: string;
    readonly statusCode: number;
    readonly details?: unknown;
    readonly timestamp: string;
  };
}

/**
 * Base operational error class for all Muxaro services.
 * Distinguishes known operational failures from unexpected system bugs.
 */
export class MuxaroError extends Error {
  public readonly code: MuxaroErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly isOperational: boolean;
  public readonly timestamp: string;

  constructor(
    message: string,
    code: MuxaroErrorCode = 'INTERNAL_ERROR',
    statusCode?: number,
    details?: unknown,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'MuxaroError';
    this.code = code;
    this.statusCode = statusCode ?? ERROR_HTTP_STATUS_MAP[code] ?? 500;
    this.details = details;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);

    const errConstructor = Error as unknown as { captureStackTrace?: (target: object, constructor: Function) => void };
    if (typeof errConstructor.captureStackTrace === 'function') {
      errConstructor.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serializes the error to a standardized API response structure
   */
  public toJSON(): MuxaroErrorPayload {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details,
        timestamp: this.timestamp,
      },
    };
  }

  // ===========================================================================
  // STATIC FACTORY CONSTRUCTORS
  // ===========================================================================

  public static badRequest(message: string = 'Bad request', details?: unknown): MuxaroError {
    return new MuxaroError(message, 'BAD_REQUEST', 400, details);
  }

  public static invalidPayload(message: string = 'Invalid request payload', details?: unknown): MuxaroError {
    return new MuxaroError(message, 'INVALID_PAYLOAD', 400, details);
  }

  public static invalidUrl(message: string = 'Invalid or unsupported media URL', details?: unknown): MuxaroError {
    return new MuxaroError(message, 'INVALID_URL', 400, details);
  }

  public static ssrfBlocked(reason: string = 'Access to private or forbidden network is blocked', details?: unknown): MuxaroError {
    return new MuxaroError(reason, 'SSRF_BLOCKED', 403, details);
  }

  public static unauthorized(message: string = 'Authentication required'): MuxaroError {
    return new MuxaroError(message, 'UNAUTHORIZED', 401);
  }

  public static forbidden(message: string = 'Permission denied'): MuxaroError {
    return new MuxaroError(message, 'FORBIDDEN', 403);
  }

  public static notFound(resource: string = 'Resource', id?: string): MuxaroError {
    const msg = id ? `${resource} with identifier "${id}" not found` : `${resource} not found`;
    return new MuxaroError(msg, 'NOT_FOUND', 404);
  }

  public static rateLimited(message: string = 'Rate limit exceeded. Please try again later.', retryAfterMs?: number): MuxaroError {
    return new MuxaroError(message, 'RATE_LIMITED', 429, retryAfterMs ? { retryAfterMs } : undefined);
  }

  public static quotaExceeded(message: string = 'Daily job allowance or concurrent limit exceeded', details?: unknown): MuxaroError {
    return new MuxaroError(message, 'QUOTA_EXCEEDED', 429, details);
  }

  public static idempotencyConflict(idempotencyKey: string): MuxaroError {
    return new MuxaroError(
      `Conflicting request already processed or processing with key "${idempotencyKey}"`,
      'IDEMPOTENCY_CONFLICT',
      409,
      { idempotencyKey }
    );
  }

  public static fileTooLarge(sizeBytes: number, limitBytes: number): MuxaroError {
    return new MuxaroError(
      `Uploaded file size (${(sizeBytes / 1024 / 1024).toFixed(1)}MB) exceeds limit (${(limitBytes / 1024 / 1024).toFixed(1)}MB)`,
      'FILE_TOO_LARGE',
      413,
      { sizeBytes, limitBytes }
    );
  }

  public static fileCorrupted(reason: string = 'Uploaded file failed magic bytes verification or is corrupted'): MuxaroError {
    return new MuxaroError(reason, 'FILE_CORRUPTED', 422);
  }

  public static drmProtected(platform: string = 'Media'): MuxaroError {
    return new MuxaroError(
      `${platform} stream is encrypted with Digital Rights Management (DRM) and cannot be processed`,
      'DRM_PROTECTED',
      422
    );
  }

  public static extractionFailed(reason: string, details?: unknown): MuxaroError {
    return new MuxaroError(
      `Upstream metadata extraction failed: ${reason}`,
      'EXTRACTION_FAILED',
      502,
      details
    );
  }

  public static transcodeFailed(reason: string, details?: unknown): MuxaroError {
    return new MuxaroError(
      `Media processing/transcode failed: ${reason}`,
      'TRANSCODE_FAILED',
      500,
      details
    );
  }

  public static uploadFailed(reason: string, details?: unknown): MuxaroError {
    return new MuxaroError(
      `Direct R2 upload failed: ${reason}`,
      'UPLOAD_FAILED',
      502,
      details
    );
  }

  public static circuitBreakerOpen(serviceName: string): MuxaroError {
    return new MuxaroError(
      `Service "${serviceName}" circuit breaker is currently OPEN due to repeated failures`,
      'CIRCUIT_BREAKER_OPEN',
      503,
      { serviceName }
    );
  }

  public static serviceUnavailable(message: string = 'Service temporarily unavailable'): MuxaroError {
    return new MuxaroError(message, 'SERVICE_UNAVAILABLE', 503);
  }

  public static expired(resource: string = 'Artifact or session'): MuxaroError {
    return new MuxaroError(`${resource} has expired and is no longer available`, 'EXPIRED', 410);
  }

  public static cancelled(reason: string = 'Job was cancelled by client'): MuxaroError {
    return new MuxaroError(reason, 'CANCELLED', 499);
  }

  public static internal(message: string = 'An internal system error occurred', details?: unknown): MuxaroError {
    return new MuxaroError(message, 'INTERNAL_ERROR', 500, details, false);
  }

  /**
   * Type guard to check if an unknown error is a MuxaroError instance
   */
  public static isMuxaroError(error: unknown): error is MuxaroError {
    return error instanceof MuxaroError;
  }
}
