import type { IngestErrorBody, IngestErrorCode } from '@photox/shared-types';

/**
 * One error envelope for every ingest door (multipart upload, upload sessions):
 * `{statusCode, message, code}` plus any route-specific context. Kept separate from
 * `uploads.service` so the multipart door can use it without importing the session service.
 */
export function ingestErrorBody(
  statusCode: number,
  message: string,
  code: IngestErrorCode,
  extra?: Record<string, unknown>,
): IngestErrorBody {
  return { statusCode, message, code, ...extra };
}
