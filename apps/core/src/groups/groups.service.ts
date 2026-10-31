import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, type Repository } from 'typeorm'
import { SEARCH_EMBEDDING_MODEL, type SearchResponse } from '@photox/shared-types'
import { Asset } from '../database/entities'
import { AssetEmbedding } from '../database/entities/asset-embedding.entity'
import { findOwnedOr404 } from '../common/asset-ownership'
import { neighbourRows } from '../database/shared/neighbours'
import { toVectorSql } from '../database/shared/pgvector'
import { AssetsService } from '../assets/assets.service'
import type { DuplicatesQueryDto, SimilarQueryDto } from './dto/groups-query.dto'

const DEFAULT_DUPLICATE_THRESHOLD = 10
const DEFAULT_SIMILAR_LIMIT = 12

@Injectable()
export class GroupsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly assets: AssetsService,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(AssetEmbedding)
    private readonly embeddingRepo: Repository<AssetEmbedding>,
  ) {}

  async duplicates(
    userId: string,
    assetId: string,
    dto: DuplicatesQueryDto,
  ): Promise<SearchResponse> {
    await findOwnedOr404(this.assetRepo, assetId, userId, 'Asset')
    const threshold = dto.threshold ?? DEFAULT_DUPLICATE_THRESHOLD
    // C7-limit-only: LIMIT 200 bounds the response (ordering stays deterministic: distance
    // ASC, id ASC). `total` is therefore capped at 200 — documented behavior change; the
    // DuplicatesQueryDto @Max(64) range is intentionally untouched (product call).
    const rows: { id: string }[] = await this.dataSource.query(
      // ('x'||phash) is the hex→bit(64) form: plain text::bit(64) only parses 0/1 strings.
      // NULL phash on either side never matches; owner + non-trashed are enforced per candidate.
      `SELECT a.id AS id
       FROM assets src
       JOIN assets a
         ON a."userId" = src."userId" AND a.id <> src.id AND a."isTrashed" = false
       WHERE src.id = $1 AND src."userId" = $2
         AND src.phash IS NOT NULL AND a.phash IS NOT NULL
         AND bit_count(('x'||a.phash)::bit(64) # ('x'||src.phash)::bit(64)) <= $3
       ORDER BY bit_count(('x'||a.phash)::bit(64) # ('x'||src.phash)::bit(64)) ASC, a.id ASC
       LIMIT 200`,
      [assetId, userId, threshold],
    )
    const items = await this.assets.listByIdsRanked(
      userId,
      rows.map((r) => r.id),
    )
    return { items, total: rows.length }
  }

  async similar(userId: string, assetId: string, dto: SimilarQueryDto): Promise<SearchResponse> {
    await findOwnedOr404(this.assetRepo, assetId, userId, 'Asset')
    const limit = dto.limit ?? DEFAULT_SIMILAR_LIMIT
    const source = await this.embeddingRepo.findOne({
      where: { assetId, kind: 'image', model: SEARCH_EMBEDDING_MODEL },
    })
    // no embedding yet (worker hasn't processed it): an empty page, not an error
    if (!source) return { items: [], total: 0 }

    const vector = toVectorSql(source.embedding)
    const options = { excludeAssetId: assetId }
    const rows = await this.dataSource.transaction(async (em) => {
      // same ef_search plumbing as search: HNSW scans cap at ef_search rows
      await em.query(`SELECT set_config('hnsw.ef_search', $1, true)`, [
        String(Math.min(limit + 1, 200)),
      ])
      return neighbourRows(em, userId, vector, limit, options)
    })
    // The index spans every user and pgvector applies the owner filter after the scan, so other
    // users' near-identical photos can fill the ef_search window and short-change this owner (an
    // empty "More like this" tray, e2e-searchable only by luck). The graph never reached the
    // missing rows, so the scan cannot be resumed for them — finish the page with an exact scan.
    const ids =
      rows.length < limit
        ? (
            await neighbourRows(this.dataSource, userId, vector, limit, {
              ...options,
              exact: true,
            })
          ).map((row) => row.id)
        : rows.map((row) => row.id)
    const items = await this.assets.listByIdsRanked(userId, ids)
    return { items, total: ids.length }
  }
}
