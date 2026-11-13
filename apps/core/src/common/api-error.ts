import { HttpException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiErrorDetail,
} from '@photox/shared-types';

/** The code a bare status maps to when the thrower did not name one. */
export function defaultCodeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
    case 405:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

/** Build the one non-2xx envelope; the exception filter serializes `getResponse()` verbatim. */
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra?: { details?: ApiErrorDetail[]; retryAfterSec?: number; [key: string]: unknown },
): HttpException {
  return new HttpException({ statusCode: status, code, message, ...extra }, status);
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.statusCode === 'number' &&
    isApiErrorCode(body.code) &&
    typeof body.message === 'string'
  );
}
