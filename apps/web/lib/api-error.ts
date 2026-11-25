import { NextResponse } from 'next/server';

export type ApiErrorCode =
  | 'HOST_BLOCKED'
  | 'INVALID_URL'
  | 'TIMEOUT'
  | 'ERR_BACKEND_NOT_CONFIGURED'
  | 'ERR_EXTRACTION_FAILED';

export interface StandardApiErrorPayload {
  ok: false;
  code: ApiErrorCode;
  status: number;
  rawMessage: string;
  // Backward compatibility fields
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
  };
  requestId?: string;
}

export function classifyApiError(
  err: unknown,
  defaultCode: ApiErrorCode = 'ERR_EXTRACTION_FAILED',
  statusOverride?: number
): { code: ApiErrorCode; status: number; rawMessage: string } {
  let rawMessage = '';
  if (typeof err === 'string') {
    rawMessage = err;
  } else if (err && typeof err === 'object') {
    rawMessage =
      (err as any).rawMessage ||
      (err as any).message ||
      (err as any).error?.message ||
      String(err);
  } else {
    rawMessage = String(err || 'Unknown error');
  }

  const lower = rawMessage.toLowerCase();

  // 0. Unbacked Serverless / Missing Binary / Unconfigured Backend -> 503
  if (
    (err as any)?.code === 'ERR_BACKEND_NOT_CONFIGURED' ||
    (err as any)?.code === 'ENOENT' ||
    lower.includes('backend_not_configured') ||
    lower.includes('backend not configured') ||
    lower.includes('api_internal_url') ||
    lower.includes('spawn yt-dlp enoent') ||
    lower.includes('spawn ffprobe enoent') ||
    lower.includes('no media backend worker')
  ) {
    return {
      code: 'ERR_BACKEND_NOT_CONFIGURED',
      status: statusOverride ?? 503,
      rawMessage,
    };
  }

  // 1. TIMEOUT
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    lower.includes('esockettimedout') ||
    lower.includes('aborterror') ||
    (err as any)?.name === 'AbortError' ||
    (err as any)?.name === 'TimeoutError' ||
    (err as any)?.code === 'TIMEOUT' ||
    (err as any)?.code === 'ERR_DOWNLOAD_TIMEOUT'
  ) {
    return {
      code: 'TIMEOUT',
      status: statusOverride ?? 504,
      rawMessage,
    };
  }

  // 2. Not Found -> 404
  if (
    lower.includes('not found') ||
    lower.includes('not_found') ||
    lower.includes('does not exist') ||
    lower.includes('has expired') ||
    (err as any)?.code === 'ERR_JOB_NOT_FOUND' ||
    (err as any)?.code === 'ERR_ARTIFACT_NOT_FOUND'
  ) {
    return {
      code: 'INVALID_URL',
      status: statusOverride ?? 404,
      rawMessage,
    };
  }

  // 3. SSRF / Restricted / Forbidden host -> 403
  if (
    lower.includes('ssrf') ||
    lower.includes('restricted') ||
    lower.includes('private ip') ||
    lower.includes('internal') ||
    lower.includes('local host') ||
    (err as any)?.code === 'SSRF_BLOCKED'
  ) {
    return {
      code: 'INVALID_URL',
      status: statusOverride ?? 403,
      rawMessage,
    };
  }

  // 4. INVALID_URL / Empty URL / Malformed -> 400
  if (
    (err as any)?.code === 'INVALID_URL' ||
    (err as any)?.code === 'ERR_EMPTY_URL' ||
    lower.includes('url cannot be empty') ||
    lower.includes('empty_url') ||
    lower.includes('url query parameter is required') ||
    lower.includes('source media url is required') ||
    lower.includes('please provide a valid media link') ||
    lower.includes('malformed url') ||
    lower.includes('only http and https') ||
    lower.includes('invalid_body') ||
    lower.includes('not a valid url') ||
    lower.includes('unsupported url') ||
    lower.includes('is not a valid url') ||
    lower.includes('err_invalid_body')
  ) {
    return {
      code: 'INVALID_URL',
      status: statusOverride ?? 400,
      rawMessage,
    };
  }

  // 5. HOST_BLOCKED (Bot check, 403, 429, cloud blocks, rate limits, Captcha)
  if (
    (err as any)?.code === 'HOST_BLOCKED' ||
    (err as any)?.code === 'ERR_YOUTUBE_BOT_CHECK' ||
    (err as any)?.code === 'BOT_CHECK' ||
    lower.includes('sign in to confirm') ||
    lower.includes("confirm you're not a bot") ||
    lower.includes('confirm you’re not a bot') ||
    lower.includes('bot') ||
    lower.includes('bot_check') ||
    lower.includes('botguard') ||
    lower.includes('403') ||
    lower.includes('forbidden') ||
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('captcha') ||
    lower.includes('challenge') ||
    lower.includes('login required') ||
    lower.includes('private video') ||
    lower.includes('join this channel') ||
    lower.includes('host_blocked') ||
    lower.includes('blocked')
  ) {
    return {
      code: 'HOST_BLOCKED',
      status: statusOverride ?? 403,
      rawMessage,
    };
  }

  // Default fallback
  const resolvedStatus =
    statusOverride ??
    (defaultCode === 'HOST_BLOCKED'
      ? 403
      : defaultCode === 'TIMEOUT'
        ? 504
        : defaultCode === 'ERR_BACKEND_NOT_CONFIGURED'
          ? 503
          : defaultCode === 'ERR_EXTRACTION_FAILED'
            ? 502
            : 400);
  return {
    code: defaultCode,
    status: resolvedStatus,
    rawMessage,
  };
}

export function createApiErrorResponse(
  err: unknown,
  defaultCode: ApiErrorCode = 'ERR_EXTRACTION_FAILED',
  requestId?: string,
  extraHeaders?: Record<string, string>,
  statusOverride?: number
): NextResponse {
  const { code, status, rawMessage } = classifyApiError(err, defaultCode, statusOverride);

  const payload: StandardApiErrorPayload = {
    ok: false,
    code,
    status,
    rawMessage,
    success: false,
    error: {
      code,
      message: rawMessage,
    },
    ...(requestId ? { requestId } : {}),
  };

  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...(extraHeaders || {}),
    },
  });
}
