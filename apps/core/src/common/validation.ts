import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';
import type { ApiErrorDetail } from '@photox/shared-types';

/** Flatten class-validator's error tree into dotted field paths + constraint messages. */
export function validationDetails(errors: ValidationError[]): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];

  const walk = (error: ValidationError, parent: string): void => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    for (const message of Object.values(error.constraints ?? {})) details.push({ field, message });
    for (const child of error.children ?? []) walk(child, field);
  };

  for (const error of errors) walk(error, '');
  return details;
}

/** The global pipe: same options as before plus the one error envelope for validation failures. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => {
      const details = validationDetails(errors);
      return new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: details.map((detail) => detail.message).join('; ') || 'Validation failed',
        details,
      });
    },
  });
}
