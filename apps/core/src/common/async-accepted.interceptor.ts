import {
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { tap, type Observable } from 'rxjs';

/**
 * Every 202 is a "come back later" answer, so it announces `Retry-After: 5` from one place
 * instead of each handler remembering it. The header is only set once the handler actually
 * returns, so a failure on a 202-declared route keeps the filter's own Retry-After semantics.
 */
@Injectable()
export class AsyncAcceptedInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const accepted =
      this.reflector.getAllAndOverride<number | undefined>(HTTP_CODE_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) === HttpStatus.ACCEPTED;
    if (!accepted) return next.handle();
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(tap(() => response.setHeader('Retry-After', '5')));
  }
}
