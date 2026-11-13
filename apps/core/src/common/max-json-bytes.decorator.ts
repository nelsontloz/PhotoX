import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * Reject a JSON blob whose serialized form exceeds `maxBytes`. The metadata columns are `jsonb`
 * and take whatever the caller sends, so an unbounded payload from a parser bug becomes a row
 * every reader pays for. Runs inside the global pipe, so the failure keeps the
 * `VALIDATION_FAILED` envelope with a field detail like every other validation error.
 */
export function MaxJsonBytes(maxBytes: number, options?: ValidationOptions) {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      name: 'maxJsonBytes',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown): boolean =>
          value === undefined ||
          value === null ||
          Buffer.byteLength(JSON.stringify(value)) <= maxBytes,
        defaultMessage: (): string => `${propertyName} must serialize to at most ${maxBytes} bytes`,
      },
    });
  };
}
