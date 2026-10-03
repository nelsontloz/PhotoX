import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { toSql } from 'pgvector'
import {
  SEARCH_EMBEDDING_DIM,
  SEARCH_EMBEDDING_MODEL,
  type SearchResponse,
} from '@photox/shared-types'
import { AssetsService } from '../assets/assets.service'
import { TextEncodeService } from './text-encode.service'
import { fuseRrf } from './rrf'
import { routeMatches } from './routing'
import type { SearchQueryDto } from './dto/search-query.dto'

const DEFAULT_LIMIT = 20
// 2N candidates per branch (N = limit + offset): enough to survive fusion demotions and offset
// paging without scanning the whole library; HNSW's default ef_search=40 covers the usual 2N.
const BRANCH_MULTIPLIER = 2
// ponytail: routed assets (person/place) are bonus-only, so cap the fan-out — a person with a
// 10k-photo library would otherwise put every one of them in the fused list
const ROUTE_ASSET_LIMIT = 200

const FTS_DOCUMENT = `to_tsvector('simple', COALESCE(a.title, '') || ' ' || COALESCE(a.description, '') || ' ' || COALESCE(o.text, ''))`

@Injectable()
export class SearchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly assets: AssetsService,
    private readonly textEncoder: TextEncodeService,
  ) {}

  async search(userId: string, dto: SearchQueryDto): Promise<SearchResponse> {
    const query = dto.q.trim()
    const limit = dto.limit ?? DEFAULT_LIMIT
    const offset = dto.offset ?? 0
    if (query === '') return { items: [], total: 0 }

    const branchLimit = BRANCH_MULTIPLIER * (limit + offset)
    // 503 before any DB work when the text tower is not provisioned
    const vector = await this.textEncoder.encode(query)

    const [annIds, ftsIds, routedIds] = await Promise.all([
      this.annIds(userId, vector, branchLimit),
      this.ftsIds(userId, query, branchLimit),
      this.routedIds(userId, query),
    ])

    const fused = fuseRrf([annIds, ftsIds], new Set(routedIds))
    const pageIds = fused.slice(offset, offset + limit).map((hit) => hit.id)
    // items come back through the list-assets serializer, so the wire shape is identical
    const items = await this.assets.listByIdsRanked(userId, pageIds)
    return { items, total: fused.length }
  }

  private async annIds(userId: string, vector: number[], limit: number): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT ae."assetId" AS id
       FROM asset_embeddings ae
       JOIN assets a ON a.id = ae."assetId"
       WHERE a."userId" = $1 AND a."isTrashed" = false
         AND ae.kind = 'image' AND ae.model = $2
       ORDER BY ae.embedding::halfvec(${SEARCH_EMBEDDING_DIM}) <=> $3::halfvec(${SEARCH_EMBEDDING_DIM})
       LIMIT $4`,
      [userId, SEARCH_EMBEDDING_MODEL, toSql(vector), limit],
    )
    return rows.map((r) => r.id)
  }

  private async ftsIds(userId: string, query: string, limit: number): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT a.id AS id
       FROM assets a
       LEFT JOIN asset_ocr o ON o."assetId" = a.id
       WHERE a."userId" = $1 AND a."isTrashed" = false
         AND ${FTS_DOCUMENT} @@ websearch_to_tsquery('simple', $2)
       ORDER BY ts_rank_cd(${FTS_DOCUMENT}, websearch_to_tsquery('simple', $2)) DESC
       LIMIT $3`,
      [userId, query, limit],
    )
    return rows.map((r) => r.id)
  }

  private async routedIds(userId: string, query: string): Promise<string[]> {
    const [persons, places] = await Promise.all([
      this.personCandidates(userId),
      this.placeCandidates(userId),
    ])
    const hits = routeMatches(query, { persons, places })
    if (hits.personIds.length === 0 && hits.places.length === 0) return []

    const [byPerson, byPlace] = await Promise.all([
      hits.personIds.length === 0 ? [] : this.assetsForPersons(userId, hits.personIds),
      hits.places.length === 0 ? [] : this.assetsForPlaces(userId, hits.places),
    ])
    return [...new Set([...byPerson, ...byPlace])].slice(0, ROUTE_ASSET_LIMIT)
  }

  private async personCandidates(userId: string): Promise<{ id: string; name: string }[]> {
    return this.dataSource.query(
      `SELECT id, name FROM persons WHERE "userId" = $1 AND name IS NOT NULL`,
      [userId],
    )
  }

  private async placeCandidates(userId: string): Promise<string[]> {
    const rows: { place: string | null }[] = await this.dataSource.query(
      `SELECT "placeCity" AS place FROM assets WHERE "userId" = $1 AND "placeCity" IS NOT NULL
       UNION
       SELECT "placeAdmin1" AS place FROM assets WHERE "userId" = $1 AND "placeAdmin1" IS NOT NULL
       UNION
       SELECT "placeCountryCode" AS place FROM assets WHERE "userId" = $1 AND "placeCountryCode" IS NOT NULL`,
      [userId],
    )
    return rows.map((r) => r.place).filter((p): p is string => p !== null)
  }

  private async assetsForPersons(userId: string, personIds: string[]): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT f."assetId" AS id
       FROM faces f
       JOIN assets a ON a.id = f."assetId"
       WHERE f."userId" = $1 AND a."isTrashed" = false AND f."personId" = ANY($2::uuid[])`,
      [userId, personIds],
    )
    return rows.map((r) => r.id)
  }

  private async assetsForPlaces(userId: string, places: string[]): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM assets
       WHERE "userId" = $1 AND "isTrashed" = false
         AND ("placeCity" = ANY($2::text[]) OR "placeAdmin1" = ANY($2::text[]) OR "placeCountryCode" = ANY($2::text[]))`,
      [userId, places],
    )
    return rows.map((r) => r.id)
  }
}
