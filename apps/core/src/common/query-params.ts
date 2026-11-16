import { BadRequestException } from '@nestjs/common';
import type { TransformFnParams } from 'class-transformer';

/**
 * Strict boolean query parsing: only a real boolean or the literals `true`/`false` pass. Any other
 * value is a 400 instead of silently meaning false — an unknown *param name* already 400s through
 * `forbidNonWhitelisted`, so a typo'd *value* must not quietly widen the result set either.
 * `undefined` stays undefined so `@IsOptional` still applies to an absent param.
 */
export function parseQueryBoolean(field: string, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: `${field} must be true or false`,
    details: [{ field, message: 'must be true or false' }],
  });
}

/** `@Transform(parseQueryBooleanParam)` for a DTO field that reads a boolean from the query. */
export function parseQueryBooleanParam({ key, value }: TransformFnParams): boolean | undefined {
  return parseQueryBoolean(key, value);
}
