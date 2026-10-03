import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource, In } from 'typeorm'
import { Asset } from '../database/entities'
import { AssetThumbnail } from '../database/entities'
import { AlbumAsset } from '../albums/entities/album-asset.entity'
import { Face } from '../database/entities'
import { CreateAssetDto } from './dto/create-asset.dto'
import { UpdateAssetDto } from './dto/update-asset.dto'
import { ListAssetsQueryDto } from './dto/list-assets-query.dto'
import { UpdateMetadataDto } from './dto/update-metadata.dto'
import { RegisterThumbnailDto } from './dto/register-thumbnail.dto'
import { FacesService } from '../faces/faces.service'
import { BullMqService } from '../queue/bullmq.service'
import type {
  Asset as AssetResponse,
  AssetLayout,
  AssetListResponse,
  AssetThumbnail as AssetThumbnailResponse,
} from '@photox/shared-types'

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private readonly repo: Repository<Asset>,
    @InjectRepository(AssetThumbnail)
    private readonly thumbRepo: Repository<AssetThumbnail>,
    private readonly dataSource: DataSource,
    private readonly facesService: FacesService,
    private readonly bullMq: BullMqService,
  ) {}

  async create(userId: string, dto: CreateAssetDto): Promise<AssetResponse> {
    const asset = new Asset()
    asset.userId = userId
    asset.fileId = dto.fileId
    asset.kind = dto.kind
    asset.title = dto.title ?? null
    asset.description = dto.description ?? null
    asset.takenAt = dto.takenAt ? new Date(dto.takenAt) : null
    asset.mimeType = dto.mimeType ?? null
    asset.sizeBytes = dto.sizeBytes ?? null
    asset.originalName = dto.originalName ?? null
    asset.transcodeStatus = dto.kind === 'video' ? 'pending' : null
    asset.thumbnailStatus = 'pending'
    const saved = await this.repo.save(asset)
    return this.toResponse(saved)
  }

  async list(userId: string, q: ListAssetsQueryDto): Promise<AssetListResponse> {
    // ponytail: ids requests need every match (legacy re-embed ≤100/run); 100 mirrors the DTO @Max
    const limit = q.limit ?? (q.ids ? Math.min(q.ids.length, 100) : 20)
    const offset = q.offset ?? 0
    const isTrashed = q.isTrashed ?? false

    const qb = this.repo.createQueryBuilder('asset').where('asset.userId = :userId', { userId })

    qb.andWhere('asset.isTrashed = :isTrashed', { isTrashed })

    if (q.ids) {
      qb.andWhere('asset.id IN (:...ids)', { ids: q.ids })
    }

    if (q.dateFrom) {
      qb.andWhere('COALESCE(asset.takenAt, asset.uploadedAt) >= :dateFrom', {
        dateFrom: q.dateFrom,
      })
    }

    if (q.dateTo) {
      qb.andWhere('COALESCE(asset.takenAt, asset.uploadedAt) < :dateTo', { dateTo: q.dateTo })
    }

    if (q.favorite !== undefined) {
      qb.andWhere('asset.favorite = :favorite', { favorite: q.favorite })
    }

    if (q.hasLocations === true) {
      qb.andWhere('asset.latitude IS NOT NULL AND asset.longitude IS NOT NULL')
    } else if (q.hasLocations === false) {
      qb.andWhere('(asset.latitude IS NULL OR asset.longitude IS NULL)')
    }

    const [items, total] = await qb
      .orderBy(`COALESCE(asset.takenAt, asset.uploadedAt)`, 'DESC')
      .addOrderBy('asset.uploadedAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getManyAndCount()

    const pageIds = items.map((a) => a.id)
    const thumbRows = pageIds.length
      ? await this.thumbRepo.find({
          where: { assetId: In(pageIds) },
          order: { createdAt: 'ASC' },
        })
      : []
    const thumbsByAsset = new Map<string, AssetThumbnail[]>()
    for (const row of thumbRows) {
      const list = thumbsByAsset.get(row.assetId) ?? []
      list.push(row)
      thumbsByAsset.set(row.assetId, list)
    }

    return {
      items: items.map((a) => this.toResponse(a, thumbsByAsset.get(a.id) ?? [])),
      total,
      limit,
      offset,
    }
  }

  /**
   * Fetch + serialize assets in the caller-provided id order (search fusion ranking), skipping
   * ids that are gone/trashed/foreign. Same wire shape as `list` via `toResponse`.
   */
  async listByIdsRanked(userId: string, ids: string[]): Promise<AssetResponse[]> {
    if (ids.length === 0) return []
    const assets = await this.repo.find({ where: { id: In(ids), userId, isTrashed: false } })
    const thumbRows = await this.thumbRepo.find({
      where: { assetId: In(ids) },
      order: { createdAt: 'ASC' },
    })
    const byId = new Map(assets.map((a) => [a.id, a]))
    const thumbsByAsset = new Map<string, AssetThumbnail[]>()
    for (const row of thumbRows) {
      const list = thumbsByAsset.get(row.assetId) ?? []
      list.push(row)
      thumbsByAsset.set(row.assetId, list)
    }
    return ids.flatMap((id) => {
      const asset = byId.get(id)
      return asset ? [this.toResponse(asset, thumbsByAsset.get(id) ?? [])] : []
    })
  }

  async layout(userId: string): Promise<AssetLayout> {
    const rows = await this.repo
      .createQueryBuilder('asset')
      .select('COALESCE(asset.takenAt, asset.uploadedAt)', 't')
      .addSelect('COALESCE(asset.width, 1)', 'w')
      .addSelect('COALESCE(asset.height, 1)', 'h')
      .where('asset.userId = :userId', { userId })
      .andWhere('asset.isTrashed = :isTrashed', { isTrashed: false })
      .orderBy('COALESCE(asset.takenAt, asset.uploadedAt)', 'DESC')
      .addOrderBy('asset.uploadedAt', 'DESC')
      .getRawMany<{ t: Date | string; w: number; h: number }>()

    return {
      items: rows.map((r) => ({
        t: r.t instanceof Date ? r.t.toISOString() : new Date(r.t).toISOString(),
        w: Number(r.w),
        h: Number(r.h),
      })),
    }
  }

  /**
   * Cheap per-user fingerprint of layout-relevant state (count + latest mutation).
   * Every add/delete/trash/restore/patch of an asset goes through TypeORM save()/update(),
   * which bumps `updatedAt`, so the fingerprint changes on any layout-visible mutation.
   * ponytail: not a hot-path cache — this only powers ETag revalidation for /layout.
   */
  async layoutFingerprint(userId: string): Promise<{ count: number; maxUpdatedAtMs: number }> {
    const row = await this.repo
      .createQueryBuilder('asset')
      .select('COUNT(*)', 'count')
      .addSelect('MAX(asset.updatedAt)', 'maxUpdatedAt')
      .where('asset.userId = :userId', { userId })
      .andWhere('asset.isTrashed = :isTrashed', { isTrashed: false })
      .getRawOne<{ count: string; maxUpdatedAt: Date | string | null }>()
    return {
      count: Number(row?.count ?? 0),
      maxUpdatedAtMs: row?.maxUpdatedAt ? new Date(row.maxUpdatedAt).getTime() : 0,
    }
  }

  async getOne(userId: string, id: string): Promise<AssetResponse> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')
    const faces = await this.facesService.getForAsset(asset.userId, id)
    const thumbRows = await this.thumbRepo.find({
      where: { assetId: id },
      order: { createdAt: 'ASC' },
    })
    return { ...this.toResponse(asset, thumbRows), faces }
  }

  async update(userId: string, id: string, dto: UpdateAssetDto): Promise<AssetResponse> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')

    const patch: Partial<Asset> = {}
    if (dto.title !== undefined) patch.title = dto.title
    if (dto.description !== undefined) patch.description = dto.description
    if (dto.takenAt !== undefined) patch.takenAt = dto.takenAt ? new Date(dto.takenAt) : null
    if (dto.favorite !== undefined) patch.favorite = dto.favorite

    if (Object.keys(patch).length === 0) {
      return this.toResponse(asset)
    }

    await this.repo.update(id, patch as Record<string, unknown>)
    const updated = await this.repo.findOne({ where: { id } })
    return this.toResponse(updated!)
  }

  async trash(userId: string, id: string): Promise<void> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')

    if (!asset.isTrashed) {
      await this.repo.update(id, { isTrashed: true, trashedAt: new Date() })
    }
  }

  async bulkTrash(userId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return
    await this.repo
      .createQueryBuilder()
      .update(Asset)
      .set({ isTrashed: true, trashedAt: new Date() })
      .where('id IN (:...assetIds) AND userId = :userId', { assetIds, userId })
      .execute()
  }

  async restore(userId: string, id: string): Promise<void> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')

    if (asset.isTrashed) {
      await this.repo.update(id, { isTrashed: false, trashedAt: null })
    }
  }

  async emptyTrash(userId: string): Promise<{ fileIds: string[] }> {
    const assets = await this.repo.find({ where: { userId, isTrashed: true } })
    if (assets.length === 0) return { fileIds: [] }
    return this.hardDelete(assets.map((a) => a.id))
  }

  async delete(userId: string, id: string): Promise<{ fileIds: string[] }> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')
    if (!asset.isTrashed)
      throw new BadRequestException('Asset must be trashed before permanent deletion')

    return this.hardDelete([id])
  }

  private async hardDelete(assetIds: string[]): Promise<{ fileIds: string[] }> {
    const assets = await this.repo.find({ where: { id: In(assetIds) } })
    const thumbRows = await this.thumbRepo.find({ where: { assetId: In(assetIds) } })
    const fileIds = [
      ...assets.flatMap((a) => [a.fileId, a.transcodeFileId].filter(Boolean) as string[]),
      ...thumbRows.map((t) => t.fileId),
    ]

    await this.dataSource.transaction(async (em) => {
      await em.delete(Face, { assetId: In(assetIds) })
      await em.delete(AlbumAsset, { assetId: In(assetIds) })
      // shares.assetId FK is ON DELETE CASCADE, so share rows fall with the asset
      await em.delete(Asset, { id: In(assetIds) })
    })
    return { fileIds }
  }

  async getByFileId(fileId: string, userId: string): Promise<AssetResponse> {
    const asset = await this.repo.findOne({ where: { fileId, userId } })
    if (!asset) throw new NotFoundException('Asset not found for fileId')
    return this.toResponse(asset)
  }

  async updateMetadata(id: string, userId: string, dto: UpdateMetadataDto): Promise<AssetResponse> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')

    // every UpdateMetadataDto field except `status` maps 1:1 to an Asset column; TypeORM
    // skips undefined values, so absent fields stay untouched
    const { status, ...fields } = dto
    const patch: Partial<Asset> = { ...fields }
    if (status !== undefined) {
      patch.metadataStatus = status
      patch.metadataExtractedAt = new Date()
    }

    await this.repo.update(id, patch as Record<string, unknown>)
    const updated = await this.repo.findOne({ where: { id } })
    return this.toResponse(updated!)
  }

  async reprocessThumbnails(userId: string, id: string): Promise<{ enqueued: number }> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')
    this.bullMq.enqueueThumbnails(asset.id, asset.fileId, asset.userId, 'thumb-reprocess')
    return { enqueued: 4 }
  }

  async reprocessVideo(userId: string, id: string): Promise<{ enqueued: number }> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')
    if (asset.kind !== 'video') throw new BadRequestException('Not a video asset')
    this.bullMq.enqueueVideo(asset.id, asset.fileId, asset.userId, { reprocess: true })
    return { enqueued: 1 }
  }

  async registerThumbnail(
    userId: string,
    assetId: string,
    dto: RegisterThumbnailDto,
  ): Promise<AssetThumbnailResponse> {
    const asset = await this.repo.findOne({ where: { id: assetId, userId } })
    if (!asset) throw new NotFoundException('Asset not found')
    await this.thumbRepo.upsert(
      [
        {
          assetId,
          size: dto.size,
          fileId: dto.fileId,
          width: dto.width,
          height: dto.height,
          bytes: dto.bytes,
        },
      ],
      ['assetId', 'size'],
    )
    const row = await this.thumbRepo.findOneOrFail({ where: { assetId, size: dto.size } })
    return toThumbnailResponse(row)
  }

  private toResponse(asset: Asset, thumbnails?: AssetThumbnail[]): AssetResponse {
    return {
      id: asset.id,
      userId: asset.userId,
      kind: asset.kind,
      fileId: asset.fileId,
      uploadedAt:
        asset.uploadedAt instanceof Date ? asset.uploadedAt.toISOString() : asset.uploadedAt,
      isTrashed: asset.isTrashed,
      trashedAt: asset.trashedAt instanceof Date ? asset.trashedAt.toISOString() : null,
      title: asset.title,
      description: asset.description,
      takenAt: asset.takenAt instanceof Date ? asset.takenAt.toISOString() : null,
      favorite: asset.favorite,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes !== null ? Number(asset.sizeBytes) : null,
      originalName: asset.originalName,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds !== null ? Number(asset.durationSeconds) : null,
      cameraMake: asset.cameraMake,
      cameraModel: asset.cameraModel,
      lensModel: asset.lensModel,
      orientation: asset.orientation,
      iso: asset.iso,
      fNumber: asset.fNumber !== null ? Number(asset.fNumber) : null,
      exposureTime: asset.exposureTime !== null ? Number(asset.exposureTime) : null,
      focalLength: asset.focalLength !== null ? Number(asset.focalLength) : null,
      latitude: asset.latitude !== null ? Number(asset.latitude) : null,
      longitude: asset.longitude !== null ? Number(asset.longitude) : null,
      altitude: asset.altitude !== null ? Number(asset.altitude) : null,
      fps: asset.fps !== null ? Number(asset.fps) : null,
      codec: asset.codec,
      hasAudio: asset.hasAudio,
      metadata: asset.metadata,
      metadataStatus: asset.metadataStatus,
      metadataExtractedAt:
        asset.metadataExtractedAt instanceof Date ? asset.metadataExtractedAt.toISOString() : null,
      transcodeStatus: asset.transcodeStatus,
      transcodeFileId: asset.transcodeFileId,
      thumbnailStatus: asset.thumbnailStatus,
      faceStatus: asset.faceStatus,
      faceCount: asset.faceCount,
      ...(thumbnails ? { thumbnails: thumbnails.map((t) => toThumbnailResponse(t)) } : {}),
    }
  }
}

export function toThumbnailResponse(t: AssetThumbnail): AssetThumbnailResponse {
  return {
    size: t.size,
    fileId: t.fileId,
    width: t.width,
    height: t.height,
    bytes: Number(t.bytes),
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
  }
}
