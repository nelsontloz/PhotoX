import type { Repository } from 'typeorm';
import type { FileRecord } from '../database/entities';

/**
 * The bytes a viewer should play: the transcode derivative when its file row still belongs to the
 * owner, else the original. A poisoned `transcodeFileId` pointer must never pull another user's
 * bytes into an authenticated stream or a public capability URL, so the ownership check is part of
 * the decision, not a caller's responsibility.
 *
 * Single implementation for the authenticated content route and the share routes.
 */
export async function playableFileId(
  fileRepo: Repository<FileRecord>,
  userId: string,
  transcodeFileId: string | null,
  fallbackFileId: string,
): Promise<string> {
  if (!transcodeFileId) return fallbackFileId;
  const file = await fileRepo.findOne({ where: { id: transcodeFileId } });
  return file?.userId === userId ? transcodeFileId : fallbackFileId;
}
