export type StudioErrorCode =
  | 'IMAGE_UNSUPPORTED_FORMAT'
  | 'IMAGE_DECODE_FAILED'
  | 'PDF_PARSE_FAILED'
  | 'OCR_MODEL_UNAVAILABLE'
  | 'MEDIA_CODEC_INCOMPATIBLE'
  | 'MICROPHONE_PERMISSION_DENIED'
  | 'SOURCE_UNSUPPORTED'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'JOB_CANCELLED'
  | 'OUTPUT_VALIDATION_FAILED';

export type StudioErrorCategory =
  | 'validation'
  | 'decode'
  | 'permission'
  | 'media'
  | 'storage'
  | 'network'
  | 'cancelled';

export interface StudioErrorPayload {
  code: StudioErrorCode;
  message: string;
  category: StudioErrorCategory;
  operation: string;
  inputRef?: string;
  recoverable: boolean;
  suggestedAction: string;
  retryable: boolean;
  correlationId: string;
}

export class StudioError extends Error {
  public readonly details: StudioErrorPayload;

  constructor(details: Omit<StudioErrorPayload, 'correlationId'> & { correlationId?: string }) {
    super(details.message);
    this.name = 'StudioError';
    this.details = {
      ...details,
      correlationId:
        details.correlationId || `mx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    };
  }
}

export function createStudioError(
  code: StudioErrorCode,
  operation: string,
  overrides?: Partial<Omit<StudioErrorPayload, 'code' | 'operation'>>
): StudioError {
  const defaults: Record<StudioErrorCode, Omit<StudioErrorPayload, 'code' | 'operation' | 'correlationId'>> = {
    IMAGE_UNSUPPORTED_FORMAT: {
      message: 'This image format cannot be decoded directly on this device.',
      category: 'validation',
      recoverable: true,
      suggestedAction: 'Convert to JPEG or PNG, or replace this item in the list.',
      retryable: false,
    },
    IMAGE_DECODE_FAILED: {
      message: 'The image file appears corrupted or truncated and could not be decoded.',
      category: 'decode',
      recoverable: true,
      suggestedAction: 'Retry decoding, replace the file, or remove it to keep valid pages.',
      retryable: true,
    },
    PDF_PARSE_FAILED: {
      message: 'Could not read this PDF. It may be damaged or password-protected.',
      category: 'decode',
      recoverable: true,
      suggestedAction: 'Unlock the PDF first or try repairing pages in PDF Tools.',
      retryable: true,
    },
    OCR_MODEL_UNAVAILABLE: {
      message: 'Local OCR language data is unavailable or failed to initialize.',
      category: 'decode',
      recoverable: true,
      suggestedAction: 'Verify the offline English OCR pack is present or switch language.',
      retryable: true,
    },
    MEDIA_CODEC_INCOMPATIBLE: {
      message: 'Direct stream copy is incompatible with the selected output container.',
      category: 'media',
      recoverable: true,
      suggestedAction: 'Switch to Re-encode (Transcode) or choose MP4/MKV output.',
      retryable: false,
    },
    MICROPHONE_PERMISSION_DENIED: {
      message: 'Microphone access was denied or unavailable.',
      category: 'permission',
      recoverable: true,
      suggestedAction: 'Enable Microphone permission in system/browser settings or type your request below.',
      retryable: true,
    },
    SOURCE_UNSUPPORTED: {
      message: 'This URL cannot be inspected directly from on-device mode.',
      category: 'network',
      recoverable: true,
      suggestedAction: 'Upload a local file, import from Google Drive, or use Desktop Studio.',
      retryable: false,
    },
    STORAGE_QUOTA_EXCEEDED: {
      message: 'Local browser storage quota is full.',
      category: 'storage',
      recoverable: true,
      suggestedAction: 'Clear old cached outputs or process smaller batches; original files are safe.',
      retryable: false,
    },
    JOB_CANCELLED: {
      message: 'Processing was cancelled.',
      category: 'cancelled',
      recoverable: true,
      suggestedAction: 'Adjust your settings and run again whenever ready.',
      retryable: true,
    },
    OUTPUT_VALIDATION_FAILED: {
      message: 'Generated output failed integrity checks or produced zero bytes.',
      category: 'decode',
      recoverable: true,
      suggestedAction: 'Check input files and try again.',
      retryable: true,
    },
  };

  const base = defaults[code];
  return new StudioError({
    ...base,
    ...overrides,
    code,
    operation,
  });
}

export function toStudioError(err: unknown, operation: string): StudioErrorPayload {
  if (err instanceof StudioError) {
    return err.details;
  }
  const msg = err instanceof Error ? err.message : String(err || 'Unexpected error');
  if (/quota/i.test(msg)) {
    return createStudioError('STORAGE_QUOTA_EXCEEDED', operation, { message: msg }).details;
  }
  if (/abort|cancel/i.test(msg)) {
    return createStudioError('JOB_CANCELLED', operation, { message: msg }).details;
  }
  if (/microphone|permission|not-allowed/i.test(msg)) {
    return createStudioError('MICROPHONE_PERMISSION_DENIED', operation, { message: msg }).details;
  }
  if (/decode|image|heic|corrupt/i.test(msg)) {
    return createStudioError('IMAGE_DECODE_FAILED', operation, { message: msg }).details;
  }
  return createStudioError('OUTPUT_VALIDATION_FAILED', operation, {
    message: msg.slice(0, 220),
  }).details;
}
