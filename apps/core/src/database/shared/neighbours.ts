import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types';

export interface NeighbourRow {
  id: string;
  dist: number;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * One owner's image-embedding neighbours of `vector`, nearest first (ANN by default).
 * `excludeAssetId` drops the source asset ("more like this"); `exact` keeps the planner off the
 * HNSW index — its global distance ordering is what starves an owner-filtered scan.
 */
export async function neighbourRows(
  q: Queryable,
  userId: string,
  vector: string,
  limit: number,
  opts: { excludeAssetId?: string; exact?: boolean } = {},
): Promise<NeighbourRow[]> {
  const distance = `ae.embedding::halfvec(${SEARCH_EMBEDDING_DIM}) <=> $3::halfvec(${SEARCH_EMBEDDING_DIM})`;
  const params: unknown[] = [userId, SEARCH_EMBEDDING_MODEL, vector, limit];
  let exclude = '';
  if (opts.excludeAssetId !== undefined) {
    params.push(opts.excludeAssetId);
    exclude = 'AND ae."assetId" <> $5';
  }
  return (await q.query(
    `SELECT ae."assetId" AS id, ${distance} AS dist
     FROM asset_embeddings ae
     JOIN assets a ON a.id = ae."assetId"
     WHERE a."userId" = $1 AND a."isTrashed" = false
       AND ae.kind = 'image' AND ae.model = $2
       ${exclude}
     ORDER BY ${opts.exact ? `(${distance}) + 0` : 'dist'}
     LIMIT $4`,
    params,
  )) as NeighbourRow[];
}
