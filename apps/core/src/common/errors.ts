/** The throwable's `name` (e.g. S3 error code), for logs that branch on it. */
export function errorName(err: unknown): string {
  return (err as { name?: string }).name ?? 'Unknown';
}

/** A human-readable message for an unknown throwable. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
