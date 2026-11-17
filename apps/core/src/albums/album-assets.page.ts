import type { Repository } from 'typeorm';
import type { AlbumAsset } from '../database/entities/album-asset.entity';
import { decodeTimestampIdCursor, encodeTimestampIdCursor } from '../common/cursor';

export interface AlbumAssetPageOptions {
  albumId: string;
  limit: number;
  /** continuation position; the caller rejects a cursor alongside a non-zero offset */
  cursor?: string;
  offset?: number;
}

/**
 * One keyset page of an album's non-trashed asset ids, newest-added first. Shared by the owner
 * route and the public share route so both page the same tuple; each caller projects its own items.
 */
export async function pageAlbumAssetIds(
  repo: Repository<AlbumAsset>,
  { albumId, limit, cursor, offset = 0 }: AlbumAssetPageOptions,
): Promise<{ assetIds: string[]; nextCursor: string | null }> {
  const qb = repo
    .createQueryBuilder('aa')
    .select('aa.assetId', 'assetId')
    .addSelect('aa.addedAt', 'addedAt')
    .innerJoin('assets', 'asset', 'asset.id = aa."assetId"')
    .where('aa.albumId = :albumId', { albumId })
    .andWhere('asset.isTrashed = false')
    .orderBy('aa.addedAt', 'DESC')
    // id completes the sort key, so a keyset cursor can compare the whole tuple
    .addOrderBy('aa.assetId', 'DESC')
    .limit(limit + 1);

  if (cursor) {
    // keyset, not offset: a bulk add mid-scroll shares one addedAt, so offset pages would
    // repeat or skip rows
    const { at, id } = decodeTimestampIdCursor(cursor);
    qb.andWhere(
      '(aa."addedAt", aa."assetId") < (:cursorAddedAt::timestamptz, :cursorAssetId::uuid)',
      { cursorAddedAt: at, cursorAssetId: id },
    );
  } else if (offset > 0) {
    qb.offset(offset);
  }

  const rows = await qb.getRawMany<{ assetId: string; addedAt: Date | string }>();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    assetIds: page.map((row) => row.assetId),
    nextCursor:
      rows.length > limit && last ? encodeTimestampIdCursor(last.addedAt, last.assetId) : null,
  };
}
