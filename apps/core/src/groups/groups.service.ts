import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, type Repository } from 'typeorm'
import { toSql } from 'pgvector'
import {
  SEARCH_EMBEDDING_DIM,
  SEARCH_EMBEDDING_MODEL,
  type EventsResponse,
  type RelatedAssetsResponse,
} from '@photox/shared-types'
import { Asset } from '../database/entities'
import { AssetEmbedding } from '../database/entities/asset-embedding.entity'
import { AssetsService } from '../assets/assets.service'
import { splitEvents, type EventSourceRow } from './events'
import type { DuplicatesQueryDto, EventsQueryDto, SimilarQueryDto } from './dto/groups-query.dto'

const DEFAULT_DUPLICATE_THRESHOLD = 10
const DEFAULT_SIMILAR_LIMIT = 12
const DEFAULT_EVENT_GAP_DAYS = 3
const DEFAULT_EVENT_LIMIT = 50

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
  ): Promise<RelatedAssetsResponse> {
    await this.assertAssetOwned(userId, assetId)
    const threshold = dto.threshold ?? DEFAULT_DUPLICATE_THRESHOLD
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
       ORDER BY bit_count(('x'||a.phash)::bit(64) # ('x'||src.phash)::bit(64)) ASC, a.id ASC`,
      [assetId, userId, threshold],
    )
    const items = await this.assets.listByIdsRanked(
      userId,
      rows.map((r) => r.id),
    )
    return { items, total: rows.length }
  }

  async similar(
    userId: string,
    assetId: string,
    dto: SimilarQueryDto,
  ): Promise<RelatedAssetsResponse> {
    await this.assertAssetOwned(userId, assetId)
    const limit = dto.limit ?? DEFAULT_SIMILAR_LIMIT
    const source = await this.embeddingRepo.findOne({
      where: { assetId, kind: 'image', model: SEARCH_EMBEDDING_MODEL },
    })
    // no embedding yet (worker hasn't processed it): an empty page, not an error
    if (!source) return { items: [], total: 0 }

    const rows: { id: string }[] = await this.dataSource.transaction(async (em) => {
      // same ef_search plumbing as search: HNSW scans cap at ef_search rows
      await em.query(`SELECT set_config('hnsw.ef_search', $1, true)`, [
        String(Math.min(limit + 1, 200)),
      ])
      return em.query(
        `SELECT ae."assetId" AS id
         FROM asset_embeddings ae
         JOIN assets a ON a.id = ae."assetId"
         WHERE a."userId" = $1 AND a."isTrashed" = false
           AND ae.kind = 'image' AND ae.model = $2
           AND ae."assetId" <> $3
         ORDER BY ae.embedding::halfvec(${SEARCH_EMBEDDING_DIM}) <=> $4::halfvec(${SEARCH_EMBEDDING_DIM})
         LIMIT $5`,
        [userId, SEARCH_EMBEDDING_MODEL, assetId, toSql(source.embedding), limit],
      )
    })
    const items = await this.assets.listByIdsRanked(
      userId,
      rows.map((r) => r.id),
    )
    return { items, total: rows.length }
  }

  async events(userId: string, dto: EventsQueryDto): Promise<EventsResponse> {
    const gapDays = dto.gapDays ?? DEFAULT_EVENT_GAP_DAYS
    const limit = dto.limit ?? DEFAULT_EVENT_LIMIT
    const rows: EventSourceRow[] = await this.dataSource.query(
      `SELECT id, COALESCE("takenAt", "uploadedAt") AS "takenAt", "placeCity", "placeCountryCode"
       FROM assets
       WHERE "userId" = $1 AND "isTrashed" = false AND kind = 'photo'
       ORDER BY COALESCE("takenAt", "uploadedAt") ASC`,
      [userId],
    )
    // splitEvents returns newest-first groups (built chronologically), then cap at `limit`
    return { groups: splitEvents(rows, gapDays).slice(0, limit) }
  }

  private async assertAssetOwned(userId: string, assetId: string): Promise<void> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId, userId } })
    if (!asset) throw new NotFoundException('Asset not found')
  }
}
