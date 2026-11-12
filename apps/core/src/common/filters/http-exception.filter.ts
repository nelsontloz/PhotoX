import {
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';

function exceptionDetail(exception: unknown): string {
  if (exception instanceof Error) return exception.stack ?? exception.message ?? exception.name;
  return String(exception);
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

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const detail =
        exception instanceof HttpException ? JSON.stringify(body) : exceptionDetail(exception);
      this.logger.error(`[ExceptionFilter] ${request.method} ${request.path} ${status}: ${detail}`);
    }
    response.status(status).json(body);
  }
}
