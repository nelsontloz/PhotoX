import { BadRequestException } from '@nestjs/common';

// Query params arrive as strings; only the four documented spellings count, and anything else is
// a 400 rather than a silently-false flag. Shared by the class-transformer @Transform decorators
// and by controllers reading raw @Query strings.
export function isQueryTrue(value: unknown): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'Expected a boolean spelled true or false',
  });
}
