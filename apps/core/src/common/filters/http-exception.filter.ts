import {
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { ApiErrorBody, ApiErrorDetail } from '@photox/shared-types';
import type { Request, Response } from 'express';
import { defaultCodeForStatus, isApiErrorCode } from '../api-error';
import { requestIdOf } from '../request-id';

function exceptionDetail(exception: unknown): string {
  if (exception instanceof Error) return exception.stack ?? exception.message ?? exception.name;
  return String(exception);
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable entity',
  429: 'Too many requests',
  503: 'Service unavailable',
};

function defaultMessageForStatus(status: number): string {
  if (status >= 500) return 'Internal server error';
  return DEFAULT_MESSAGES[status] ?? 'Request failed';
}

// Keys normalized into the envelope itself; everything else is a thrower's extra context.
const ENVELOPE_KEYS = new Set([
  'statusCode',
  'code',
  'message',
  'details',
  'retryAfterSec',
  'error',
]);

/** Turn a thrower's response body into the one envelope, preserving its unknown extra keys. */
function normalizeBody(status: number, raw: unknown): ApiErrorBody {
  if (typeof raw === 'string') {
    return {
      statusCode: status,
      code: defaultCodeForStatus(status),
      message: raw || defaultMessageForStatus(status),
    };
  }

  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const extras = Object.fromEntries(
    Object.entries(body).filter(([key]) => !ENVELOPE_KEYS.has(key)),
  );
  const rawMessage = body.message;
  const rawDetails = body.details;
  const rawRetryAfterSec = body.retryAfterSec;

  let message = '';
  let details: ApiErrorDetail[] | undefined;
  if (typeof rawMessage === 'string') {
    message = rawMessage;
  } else if (Array.isArray(rawMessage)) {
    const entries = rawMessage.map((entry) => (typeof entry === 'string' ? entry : String(entry)));
    message = entries.join('; ');
    details = entries.map((entry) => ({ message: entry }));
  }
  if (message === '') message = defaultMessageForStatus(status);
  if (Array.isArray(rawDetails) && rawDetails.length > 0) {
    details = rawDetails as ApiErrorDetail[];
  }

  const normalized: ApiErrorBody = {
    statusCode: status,
    code: isApiErrorCode(body.code) ? body.code : defaultCodeForStatus(status),
    message,
    ...extras,
  };
  if (details?.length) normalized.details = details;
  if (typeof rawRetryAfterSec === 'number') normalized.retryAfterSec = rawRetryAfterSec;
  return normalized;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody = {
      statusCode: status,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = normalizeBody(status, exception.getResponse());
    }

    const requestId = requestIdOf(request);
    if (requestId !== undefined) body.requestId = requestId;
    if (typeof body.retryAfterSec === 'number') {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil(body.retryAfterSec))));
    }

    // Every failure is logged now, not just 5xx: a 401/403/429 is exactly what you need to see
    // during an incident, and unmatched paths stay in the request log below the filter level.
    const userId = (request as Request & { user?: { sub?: string } }).user?.sub ?? '-';
    const line = `[ExceptionFilter] ${request.method} ${request.path} ${status} rid=${requestId ?? '-'} user=${userId}`;
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const detail =
        exception instanceof HttpException ? JSON.stringify(body) : exceptionDetail(exception);
      this.logger.error(`${line}: ${detail}`);
    } else {
      this.logger.warn(`${line}: ${body.message}`);
    }
    response.status(status).json(body);
  }
}
