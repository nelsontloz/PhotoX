import { apiError } from './api-error';

/**
 * Opaque cursor codec for the keyset-paginated lists. The payload is the last row's full ORDER BY
 * tuple: every value the query compares against, nothing else. Keep it opaque — clients pass it
 * back verbatim and sort-key details stay ours (AIP-158: a token must not be user-parseable).
 */
export function encodeCursor(values: readonly string[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

/** A malformed/foreign cursor is a client error, never a 500 from a downstream decoder. */
export function invalidCursor(message = 'Invalid cursor'): never {
  throw apiError(400, 'INVALID_CURSOR', message);
}

/** Decode an opaque cursor into its raw string parts. */
export function decodeCursor(raw: string, expectedLength: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    invalidCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== expectedLength) invalidCursor();
  if (parsed.some((part) => typeof part !== 'string')) invalidCursor();
  return parsed as string[];
}
