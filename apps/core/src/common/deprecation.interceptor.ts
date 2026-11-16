import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { DEPRECATED_ON, deprecationFor } from './deprecations';

/**
 * Answers on a deprecated route and says so: `Deprecation` (RFC 9745) when it was retired from
 * favour, `Sunset` (RFC 8594) when it disappears, `Link` to the successor. Registered as a global
 * interceptor so a route listed in `deprecations.ts` needs no per-handler plumbing — the registry
 * drives both the header and the OpenAPI flag.
 */
@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  private readonly deprecatedAt = `@${Math.floor(new Date(DEPRECATED_ON).getTime() / 1000)}`;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const deprecation = deprecationFor(request.method, request.path);
    if (deprecation) {
      const response = http.getResponse<Response>();
      response.setHeader('Deprecation', this.deprecatedAt);
      response.setHeader('Sunset', new Date(deprecation.sunset).toUTCString());
      if (deprecation.replacement) {
        response.setHeader('Link', `<${deprecation.replacement.path}>; rel="successor-version"`);
      }
    }
    return next.handle();
  }
}
