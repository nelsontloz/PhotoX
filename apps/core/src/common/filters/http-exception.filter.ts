import {
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestIdOf } from '../request-id';

function exceptionDetail(exception: unknown): string {
  if (exception instanceof Error) return exception.stack ?? exception.message ?? exception.name;
  return String(exception);
}

/** The message a client saw, without dumping a whole response body into the log. */
function clientMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'message' in body) {
    const { message } = body;
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
  return '';
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: unknown = { statusCode: status, message: 'Internal server error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = exception.getResponse();
    }

    // Every failure is logged now, not just 5xx: a 401/403/429 is exactly what you need to see
    // during an incident, and unmatched paths stay in the request log below the filter level.
    const requestId = requestIdOf(request) ?? '-';
    const userId = (request as Request & { user?: { sub?: string } }).user?.sub ?? '-';
    const line = `[ExceptionFilter] ${request.method} ${request.path} ${status} rid=${requestId} user=${userId}`;
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const detail =
        exception instanceof HttpException ? JSON.stringify(body) : exceptionDetail(exception);
      this.logger.error(`${line}: ${detail}`);
    } else {
      this.logger.warn(`${line}: ${clientMessage(body)}`);
    }
    response.status(status).json(body);
  }
}
