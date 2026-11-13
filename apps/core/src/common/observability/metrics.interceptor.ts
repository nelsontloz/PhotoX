import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { MetricsService } from './metrics.service';

// Unmatched requests (404s, probes, scanners) collapse into one series: labelling them by raw
// path would let a scanner create unbounded cardinality in the registry.
const UNMATCHED_ROUTE = 'unmatched';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();
    // Express records the matched route template (`/api/v1/assets/:id`), never the concrete path.
    const route =
      (request as unknown as { route?: { path?: string } }).route?.path ?? UNMATCHED_ROUTE;

    const record = (status: number): void => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      this.metrics.observeRequest(request.method, route, status, durationMs);
    };

    return next.handle().pipe(
      tap(() => record(response.statusCode)),
      catchError((error: unknown) => {
        record(error instanceof HttpException ? error.getStatus() : 500);
        return throwError(() => error);
      }),
    );
  }
}
