/**
 * Project MUXARO - Source Adapter Domain Errors
 * 
 * Standardized typed error classes providing actionable error codes,
 * HTTP status codes, and security-safe client messaging.
 */

export class SourceAdapterError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, statusCode: number = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SourceAdapterError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnsupportedSourceError extends SourceAdapterError {
  constructor(url: string, details?: Record<string, unknown>) {
    super(`Unsupported media source URL: ${url}`, 'UNSUPPORTED_SOURCE', 400, { url, ...details });
    this.name = 'UnsupportedSourceError';
  }
}

export class RightsViolationError extends SourceAdapterError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RIGHTS_VIOLATION', 403, details);
    this.name = 'RightsViolationError';
  }
}

export class SSRFBlockedError extends SourceAdapterError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super(`Request blocked by SSRF defense: ${reason}`, 'SSRF_BLOCKED', 403, details);
    this.name = 'SSRFBlockedError';
  }
}

export class AbuseDetectedError extends SourceAdapterError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super(`Request blocked due to abuse or suspicious anomaly: ${reason}`, 'ABUSE_DETECTED', 400, details);
    this.name = 'AbuseDetectedError';
  }
}

export class InspectionTimeoutError extends SourceAdapterError {
  constructor(timeoutMs: number, url: string) {
    super(`Source media inspection timed out after ${timeoutMs}ms: ${url}`, 'INSPECTION_TIMEOUT', 504, { timeoutMs, url });
    this.name = 'InspectionTimeoutError';
  }
}

export class InvalidMediaError extends SourceAdapterError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'INVALID_MEDIA', 422, details);
    this.name = 'InvalidMediaError';
  }
}

export class ExtractionDisabledError extends SourceAdapterError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EXTRACTION_DISABLED', 403, details);
    this.name = 'ExtractionDisabledError';
  }
}
