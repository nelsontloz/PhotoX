import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Brackets } from 'typeorm'
import { Asset } from '../entities/asset.entity'
import { CreateAssetDto } from './dto/create-asset.dto'
import { UpdateAssetDto } from './dto/update-asset.dto'
import { ListAssetsQueryDto } from './dto/list-assets-query.dto'
import { UpdateMetadataDto } from './dto/update-metadata.dto'
import type { Asset as AssetResponse, AssetListResponse } from '@photox/shared-types'

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private readonly repo: Repository<Asset>,
  ) {}

  async create(userId: string, dto: CreateAssetDto): Promise<AssetResponse> {
    const asset = new Asset()
    asset.userId = userId
    asset.fileId = dto.fileId
    asset.kind = dto.kind
    asset.title = dto.title ?? null
    asset.description = dto.description ?? null
    asset.takenAt = dto.takenAt ? new Date(dto.takenAt) : null
    const saved = await this.repo.save(asset)
    return this.toResponse(saved)
  }

  async list(userId: string, q: ListAssetsQueryDto): Promise<AssetListResponse> {
    const limit = q.limit ?? 20
    const offset = q.offset ?? 0
    const isTrashed = q.isTrashed ?? false

    const qb = this.repo.createQueryBuilder('asset').where('asset.userId = :userId', { userId })

    qb.andWhere('asset.isTrashed = :isTrashed', { isTrashed })

    if (q.kind) {
      qb.andWhere('asset.kind = :kind', { kind: q.kind })
    }

    if (q.mimeType) {
      qb.andWhere('asset.mimeType LIKE :mimeType', { mimeType: `${q.mimeType}%` })
    }

    if (q.fromDate && q.toDate) {
      qb.andWhere(
        new Brackets((sub) =>
          sub
            .where('asset.takenAt BETWEEN :fromDate AND :toDate', {
              fromDate: q.fromDate,
              toDate: q.toDate,
            })
            .orWhere('asset.takenAt IS NULL AND asset.uploadedAt BETWEEN :fromDate AND :toDate', {
              fromDate: q.fromDate,
              toDate: q.toDate,
            }),
        ),
      )
    } else if (q.fromDate) {
      qb.andWhere(
        new Brackets((sub) =>
          sub
            .where('asset.takenAt >= :fromDate', { fromDate: q.fromDate })
            .orWhere('asset.takenAt IS NULL AND asset.uploadedAt >= :fromDate', {
              fromDate: q.fromDate,
            }),
        ),
      )
    } else if (q.toDate) {
      qb.andWhere(
        new Brackets((sub) =>
          sub
            .where('asset.takenAt <= :toDate', { toDate: q.toDate })
            .orWhere('asset.takenAt IS NULL AND asset.uploadedAt <= :toDate', {
              toDate: q.toDate,
            }),
        ),
      )
    }

    if (q.favorite !== undefined) {
      qb.andWhere('asset.favorite = :favorite', { favorite: q.favorite })
    }

    if (q.metadataStatus) {
      qb.andWhere('asset.metadataStatus = :metadataStatus', { metadataStatus: q.metadataStatus })
    }

    const [items, total] = await qb
      .orderBy(`COALESCE(asset.takenAt, asset.uploadedAt)`, 'DESC')
      .addOrderBy('asset.uploadedAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getManyAndCount()

    return { items: items.map((a) => this.toResponse(a)), total, limit, offset }
  }

  async getOne(userId: string, id: string): Promise<AssetResponse> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')
    return this.toResponse(asset)
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

  async restore(userId: string, id: string): Promise<void> {
    const asset = await this.repo.findOne({ where: { id, userId } })
    if (!asset) throw new NotFoundException('Asset not found')

    if (asset.isTrashed) {
      await this.repo.update(id, { isTrashed: false, trashedAt: null })
    }
  }

  async listByUser(userId: string): Promise<AssetResponse[]> {
    const assets = await this.repo.find({ where: { userId }, order: { uploadedAt: 'DESC' } })
    return assets.map((a) => this.toResponse(a))
  }

  async getByFileId(fileId: string): Promise<AssetResponse> {
    const asset = await this.repo.findOne({ where: { fileId } })
    if (!asset) throw new NotFoundException('Asset not found for fileId')
    return this.toResponse(asset)
  }

  async updateMetadata(id: string, dto: UpdateMetadataDto): Promise<AssetResponse> {
    const asset = await this.repo.findOne({ where: { id } })
    if (!asset) throw new NotFoundException('Asset not found')

    const patch: Partial<Asset> = {}
    if (dto.status !== undefined) {
      patch.metadataStatus = dto.status
      patch.metadataExtractedAt = new Date()
    }

    if (dto.takenAt !== undefined) patch.takenAt = dto.takenAt
    if (dto.mimeType !== undefined) patch.mimeType = dto.mimeType
    if (dto.sizeBytes !== undefined) patch.sizeBytes = dto.sizeBytes
    if (dto.originalName !== undefined) patch.originalName = dto.originalName
    if (dto.width !== undefined) patch.width = dto.width
    if (dto.height !== undefined) patch.height = dto.height
    if (dto.durationSeconds !== undefined) patch.durationSeconds = dto.durationSeconds
    if (dto.fps !== undefined) patch.fps = dto.fps
    if (dto.codec !== undefined) patch.codec = dto.codec
    if (dto.hasAudio !== undefined) patch.hasAudio = dto.hasAudio
    if (dto.cameraMake !== undefined) patch.cameraMake = dto.cameraMake
    if (dto.cameraModel !== undefined) patch.cameraModel = dto.cameraModel
    if (dto.lensModel !== undefined) patch.lensModel = dto.lensModel
    if (dto.orientation !== undefined) patch.orientation = dto.orientation
    if (dto.iso !== undefined) patch.iso = dto.iso
    if (dto.fNumber !== undefined) patch.fNumber = dto.fNumber
    if (dto.exposureTime !== undefined) patch.exposureTime = dto.exposureTime
    if (dto.focalLength !== undefined) patch.focalLength = dto.focalLength
    if (dto.latitude !== undefined) patch.latitude = dto.latitude
    if (dto.longitude !== undefined) patch.longitude = dto.longitude
    if (dto.altitude !== undefined) patch.altitude = dto.altitude
    if (dto.metadata !== undefined) patch.metadata = dto.metadata
    if (dto.hlsMasterKey !== undefined) patch.hlsMasterKey = dto.hlsMasterKey
    if (dto.transcodeStatus !== undefined) patch.transcodeStatus = dto.transcodeStatus
    if (dto.transcodedAt !== undefined) patch.transcodedAt = dto.transcodedAt

    await this.repo.update(id, patch as Record<string, unknown>)
    const updated = await this.repo.findOne({ where: { id } })
    return this.toResponse(updated!)
  }

  private toResponse(asset: Asset): AssetResponse {
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
      hlsMasterKey: asset.hlsMasterKey,
      transcodeStatus: asset.transcodeStatus,
      transcodedAt: asset.transcodedAt instanceof Date ? asset.transcodedAt.toISOString() : null,
    }
  }
}
