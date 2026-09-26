import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, LessThan, Repository } from 'typeorm'
import { readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import { loadEnv } from '@photox/shared-config'
import { BullMqService } from './bullmq.service'
import { AssetThumbnail, FileRecord, LocalStorageService } from '@photox/data-access'

const ORPHAN_GRACE_MS = 10 * 60 * 1000

@Injectable()
export class CleanupOrphansProcessor {
  private readonly logger = new Logger(CleanupOrphansProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly dataSource: DataSource,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    @InjectRepository(AssetThumbnail)
    private readonly thumbRepo: Repository<AssetThumbnail>,
    private readonly storage: LocalStorageService,
  ) {}

  start() {
    this.bullMq.createWorker('cleanup-orphans', () => this.processJob(), {
      concurrency: 1,
    })
    this.logger.log('Cleanup orphans processor listening for jobs')
  }

  private async processJob() {
    this.logger.log('Orphan cleanup starting')

    const mediaRows: { fileId: string }[] = await this.dataSource.query(`
      SELECT "fileId" AS "fileId" FROM assets
      UNION
      SELECT "transcodeFileId" AS "fileId" FROM assets WHERE "transcodeFileId" IS NOT NULL
      UNION
      SELECT "fileId" AS "fileId" FROM asset_thumbnails
    `)
    const mediaFileIds = new Set(mediaRows.map((r) => r.fileId).filter(Boolean))

    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS)
    const storageRows = await this.fileRepo.find({
      select: ['id'],
      where: { createdAt: LessThan(cutoff) },
    })
    const storageFileIds = storageRows.map((r) => r.id)

    const orphanFileIds = storageFileIds.filter((id) => !mediaFileIds.has(id))
    this.logger.log(`Found ${orphanFileIds.length} orphan files`)

    const freshRows: { fileId: string }[] = await this.dataSource.query(`
      SELECT "fileId" AS "fileId" FROM assets
      UNION
      SELECT "transcodeFileId" AS "fileId" FROM assets WHERE "transcodeFileId" IS NOT NULL
      UNION
      SELECT "fileId" AS "fileId" FROM asset_thumbnails
    `)
    const freshMediaFileIds = new Set(freshRows.map((r) => r.fileId).filter(Boolean))
    const toDelete = orphanFileIds.filter((id) => !freshMediaFileIds.has(id))

    let orphanThumbRows: { assetId: string; size: string; fileId: string }[] = []
    if (storageFileIds.length > 0) {
      const thumbCutoff = new Date(Date.now() - ORPHAN_GRACE_MS)
      orphanThumbRows = await this.thumbRepo
        .createQueryBuilder('t')
        .select(['t."assetId"', 't.size', 't."fileId"'])
        .where('t."fileId" NOT IN (:...ids)', { ids: storageFileIds })
        .andWhere('t."createdAt" < :cutoff', { cutoff: thumbCutoff })
        .getRawMany()
    }
    this.logger.log(`Found ${orphanThumbRows.length} orphan thumbnail rows`)

    let deleted = 0
    for (const fileId of toDelete) {
      try {
        const record = await this.fileRepo.findOne({ where: { id: fileId } })
        if (!record) continue
        await this.storage.delete(record.storageKey)
        await this.fileRepo.remove(record)
        deleted++
      } catch (err) {
        this.logger.warn(
          `Failed to delete orphan file ${fileId}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    for (const { assetId, size } of orphanThumbRows) {
      try {
        await this.thumbRepo.delete({ assetId, size })
      } catch (err) {
        this.logger.warn(
          `Failed to delete orphan thumbnail ${assetId}/${size}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // ponytail: disk strays — files under STORAGE_DIR with no FileRecord row (crashed uploads, manual copies); *.tmp staging files are mid-write, leave them
    const knownKeys = new Set(
      (await this.fileRepo.find({ select: ['storageKey'] })).map((r) => r.storageKey),
    )
    let strayDeleted = 0
    for (const key of await this.listDiskKeys()) {
      if (!knownKeys.has(key)) {
        try {
          await this.storage.delete(key)
          strayDeleted++
        } catch (err) {
          this.logger.warn(
            `Failed to delete stray disk file ${key}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }

    this.logger.log(
      `Orphan cleanup complete: deleted ${deleted} files, ${orphanThumbRows.length} thumbnail rows, ${strayDeleted} stray disk files`,
    )
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
}
