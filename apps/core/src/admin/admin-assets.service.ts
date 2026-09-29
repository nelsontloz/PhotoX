import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, LessThan, Repository } from 'typeorm'
import { readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import { loadEnv, LocalStorageService } from '@photox/shared-config'
import { Asset, AssetThumbnail, FileRecord } from '../database/entities'
import type {
  AdminAssetCountsResponse,
  AdminAssetReprocessListResponse,
  AssetFailureCounts,
} from '@photox/shared-types'

const STUCK_PROCESSING_HOURS = 12
const ORPHAN_GRACE_MS = 10 * 60 * 1000
const REFERENCED_FILE_IDS_SQL = `
  SELECT "fileId" AS "fileId" FROM assets
  UNION
  SELECT "transcodeFileId" AS "fileId" FROM assets WHERE "transcodeFileId" IS NOT NULL
  UNION
  SELECT "fileId" AS "fileId" FROM asset_thumbnails
`

@Injectable()
export class AdminAssetsService {
  private readonly logger = new Logger(AdminAssetsService.name)

  constructor(
    @InjectRepository(Asset) private readonly repo: Repository<Asset>,
    private readonly dataSource: DataSource,
    @InjectRepository(FileRecord) private readonly files: Repository<FileRecord>,
    @InjectRepository(AssetThumbnail) private readonly thumbs: Repository<AssetThumbnail>,
    private readonly storage: LocalStorageService,
  ) {}

  async getOrphanCounts(): Promise<{ orphanFiles: number; orphanThumbnails: number }> {
    const mediaFileIds = await this.getReferencedFileIds()
    const storageFileIds = await this.getStaleFileIds()
    const orphanFiles = storageFileIds.filter((id) => !mediaFileIds.has(id)).length
    const orphanThumbnails = (await this.findOrphanThumbs(storageFileIds)).length
    return { orphanFiles, orphanThumbnails }
  }

  async cleanupOrphans(): Promise<{
    deletedFiles: number
    deletedThumbnails: number
    deletedStrays: number
  }> {
    const mediaFileIds = await this.getReferencedFileIds()
    const storageFileIds = await this.getStaleFileIds()
    const orphanFileIds = storageFileIds.filter((id) => !mediaFileIds.has(id))

    // re-query right before deleting: an in-flight job may have referenced a file after the first scan
    const freshMediaFileIds = await this.getReferencedFileIds()
    const toDelete = orphanFileIds.filter((id) => !freshMediaFileIds.has(id))

    const orphanThumbs = await this.findOrphanThumbs(storageFileIds)

    let deletedFiles = 0
    for (const fileId of toDelete) {
      try {
        const record = await this.files.findOne({ where: { id: fileId } })
        if (!record) continue
        await this.storage.delete(record.storageKey)
        await this.files.remove(record)
        deletedFiles++
      } catch (err) {
        this.logger.warn(
          `Failed to delete orphan file ${fileId}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    let deletedThumbnails = 0
    for (const thumb of orphanThumbs) {
      try {
        await this.thumbs.delete({ assetId: thumb.assetId, size: thumb.size })
        deletedThumbnails++
      } catch (err) {
        this.logger.warn(
          `Failed to delete orphan thumbnail ${thumb.assetId}/${thumb.size}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // ponytail: disk strays — files under STORAGE_DIR with no FileRecord row (crashed uploads, manual copies); *.tmp staging files are mid-write, leave them
    const knownKeys = new Set(
      (await this.files.find({ select: ['storageKey'] })).map((r) => r.storageKey),
    )
    let deletedStrays = 0
    for (const key of await this.listDiskKeys()) {
      if (!knownKeys.has(key)) {
        try {
          await this.storage.delete(key)
          deletedStrays++
        } catch (err) {
          this.logger.warn(
            `Failed to delete stray disk file ${key}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }

    return { deletedFiles, deletedThumbnails, deletedStrays }
  }

  private async getReferencedFileIds(): Promise<Set<string>> {
    const rows: { fileId: string }[] = await this.dataSource.query(REFERENCED_FILE_IDS_SQL)
    return new Set(rows.map((r) => r.fileId).filter(Boolean))
  }

  private async getStaleFileIds(): Promise<string[]> {
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS)
    const rows = await this.files.find({ select: ['id'], where: { createdAt: LessThan(cutoff) } })
    return rows.map((r) => r.id)
  }

  private async findOrphanThumbs(staleFileIds: string[]): Promise<AssetThumbnail[]> {
    if (staleFileIds.length === 0) return []
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS)
    return this.thumbs
      .createQueryBuilder('t')
      .where('t."fileId" NOT IN (:...ids)', { ids: staleFileIds })
      .andWhere('t."createdAt" < :cutoff', { cutoff })
      .getMany()
  }

  private async listDiskKeys(): Promise<string[]> {
    const root = loadEnv().STORAGE_DIR
    const keys: string[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        const full = join(dir, entry)
        const key = relative(root, full)
        if (key === 'models' || key.startsWith('models/')) continue
        const s = await stat(full).catch(() => null)
        if (!s) continue
        if (s.isDirectory()) {
          await walk(full)
        } else if (!entry.endsWith('.tmp')) {
          keys.push(key)
        }
      }
    }
    await walk(root)
    return keys
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
