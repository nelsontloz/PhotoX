import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, LessThan, Repository } from 'typeorm'
import { Asset, AssetThumbnail, FileRecord } from '@photox/data-access'
import type {
  AdminAssetCountsResponse,
  AdminAssetReprocessListResponse,
  AssetFailureCounts,
} from '@photox/shared-types'

const STUCK_PROCESSING_HOURS = 12

@Injectable()
export class AdminAssetsService {
  constructor(
    @InjectRepository(Asset) private readonly repo: Repository<Asset>,
    private readonly dataSource: DataSource,
    @InjectRepository(FileRecord) private readonly files: Repository<FileRecord>,
    @InjectRepository(AssetThumbnail) private readonly thumbs: Repository<AssetThumbnail>,
  ) {}

  async getOrphanCounts(): Promise<{ orphanFiles: number; orphanThumbnails: number }> {
    const mediaRows: { fileId: string }[] = await this.dataSource.query(`
      SELECT "fileId" AS "fileId" FROM assets
      UNION
      SELECT "transcodeFileId" AS "fileId" FROM assets WHERE "transcodeFileId" IS NOT NULL
      UNION
      SELECT "fileId" AS "fileId" FROM asset_thumbnails
    `)
    const mediaFileIds = new Set(mediaRows.map((r) => r.fileId).filter(Boolean))

    const cutoff = new Date(Date.now() - 10 * 60 * 1000)
    const storageRows = await this.files.find({
      select: ['id'],
      where: { createdAt: LessThan(cutoff) },
    })
    const storageFileIds = storageRows.map((r) => r.id)
    const orphanFiles = storageFileIds.filter((id) => !mediaFileIds.has(id)).length

    let orphanThumbnails = 0
    if (storageFileIds.length > 0) {
      orphanThumbnails = await this.thumbs
        .createQueryBuilder('t')
        .where('t."fileId" NOT IN (:...ids)', { ids: storageFileIds })
        .andWhere('t."createdAt" < :cutoff', { cutoff })
        .getCount()
    }
    return { orphanFiles, orphanThumbnails }
  }

  async getFailureCounts(): Promise<AdminAssetCountsResponse> {
    const stuckPredicate = `("metadataStatus" = 'pending' OR "thumbnailStatus" = 'pending' OR "transcodeStatus" = 'pending') AND "uploadedAt" < NOW() - INTERVAL '${STUCK_PROCESSING_HOURS} hours'`

    const rows = await this.repo
      .createQueryBuilder('a')
      .select('a.kind', 'kind')
      .addSelect(`COUNT(*) FILTER (WHERE ${stuckPredicate})`, 'processing')
      .addSelect(`COUNT(*) FILTER (WHERE "metadataStatus" = 'failed')`, 'metadata')
      .addSelect(`COUNT(*) FILTER (WHERE "thumbnailStatus" = 'failed')`, 'thumbnails')
      .addSelect(`COUNT(*) FILTER (WHERE "transcodeStatus" = 'failed')`, 'encoding')
      .where('a."isTrashed" = false')
      .groupBy('a.kind')
      .getRawMany<{
        kind: 'photo' | 'video'
        processing: string
        metadata: string
        thumbnails: string
        encoding: string
      }>()

    const empty: AssetFailureCounts = { processing: 0, metadata: 0, thumbnails: 0, encoding: 0 }
    const result: AdminAssetCountsResponse = {
      photos: { ...empty },
      videos: { ...empty },
    }

    for (const row of rows) {
      const target = row.kind === 'video' ? result.videos : result.photos
      target.processing = Number(row.processing)
      target.metadata = Number(row.metadata)
      target.thumbnails = Number(row.thumbnails)
      target.encoding = Number(row.encoding)
    }

    return result
  }

  async listForReprocess(
    kind: 'photo' | 'video',
    limit: number,
    offset: number,
  ): Promise<AdminAssetReprocessListResponse> {
    const qb = this.repo
      .createQueryBuilder('a')
      .select(['a.id AS id', 'a."userId" AS "userId"', 'a."fileId" AS "fileId"'])
      .where('a.kind = :kind', { kind })
      .andWhere('a."isTrashed" = false')

    const [rows, total] = await Promise.all([
      qb
        .orderBy('a."uploadedAt"', 'ASC')
        .limit(limit)
        .offset(offset)
        .getRawMany<{ id: string; userId: string; fileId: string }>(),
      qb.getCount(),
    ])

    return { items: rows, total }
  }
}
