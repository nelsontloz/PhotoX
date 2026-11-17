import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types';
import type { DataSource } from 'typeorm';

export interface NeighbourRow {
  id: string;
  dist: number;
}

/** HNSW returns ~ef_search rows per scan (iterative scans off in pgvector 0.8.x), so a LIMIT
 * above that under-delivers; 200 is the hard cap. */
const MAX_EF_SEARCH = 200;

/**
 * One owner's image-embedding neighbours of `vector`, nearest first (ANN by default).
 * `excludeAssetId` drops the source asset ("more like this"); `exact` keeps the planner off the
 * HNSW index — its global distance ordering is what starves an owner-filtered scan.
 *
 * The ANN scan is wrapped in a transaction because `hnsw.ef_search` is scoped to it: setting it
 * outside a transaction would outlive the statement on the pooled connection.
 */
export async function neighbourRows(
  dataSource: DataSource,
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
  const run = (queryable: { query(sql: string, params?: unknown[]): Promise<unknown> }) =>
    queryable.query(
      `SELECT ae."assetId" AS id, ${distance} AS dist
       FROM asset_embeddings ae
       JOIN assets a ON a.id = ae."assetId"
       WHERE a."userId" = $1 AND a."isTrashed" = false
         AND ae.kind = 'image' AND ae.model = $2
         ${exclude}
       ORDER BY ${opts.exact ? `(${distance}) + 0` : 'dist'}, ae."assetId" ASC
       LIMIT $4`,
      params,
    );

  const rows = opts.exact
    ? await run(dataSource)
    : await dataSource.transaction(async (em) => {
        // one row of headroom so excluding the source asset still fills the page
        await em.query(`SELECT set_config('hnsw.ef_search', $1, true)`, [
          String(Math.min(limit + 1, MAX_EF_SEARCH)),
        ]);
        return run(em);
      });
  return rows as NeighbourRow[];
}
