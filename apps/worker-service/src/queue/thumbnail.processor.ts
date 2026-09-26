import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { copyFile, unlink, writeFile } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { Asset, AssetThumbnail, FileRecord, LocalStorageService } from '@photox/data-access'
import { runFfmpeg } from './ffmpeg'

const STANDARD_SIZES: Record<string, [number, number]> = {
  sm: [150, 150],
  md: [300, 300],
  lg: [600, 600],
  xl: [1920, 1920],
}

// ponytail: fit: 'inside' preserves the source aspect ratio (landscape/portrait); 'cover' was cropping to a square, which broke the downstream masonry grid.
const RESIZE_OPTIONS: Record<string, sharp.ResizeOptions> = {
  sm: { fit: 'inside' },
  md: { fit: 'inside' },
  lg: { fit: 'inside' },
  xl: { fit: 'inside' },
}

const WEBP_QUALITY: Record<string, number> = {
  sm: 80,
  md: 80,
  lg: 80,
  xl: 85,
}

interface ThumbnailJob {
  assetId: string
  fileId: string
  size: string
  userId: string
}

@Injectable()
export class ThumbnailProcessor {
  private readonly logger = new Logger(ThumbnailProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(AssetThumbnail)
    private readonly thumbRepo: Repository<AssetThumbnail>,
    private readonly storage: LocalStorageService,
  ) {}

  start() {
    this.bullMq.createWorker<ThumbnailJob>('process-thumbnail', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('Thumbnail processor listening for jobs')
  }

  private async processJob(job: Job<ThumbnailJob>) {
    const { assetId, fileId, size, userId } = job.data

    this.logger.log(`Processing thumbnail: asset=${assetId}, size=${size}`)

    try {
      await this.generateThumbnail(fileId, assetId, size, userId)

      this.logger.log(`Thumbnail complete: asset=${assetId}, size=${size}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Thumbnail failed: asset=${assetId}, size=${size} — ${message}`)

      try {
        await this.assetRepo.update(assetId, { thumbnailStatus: 'failed' })
      } catch (patchErr) {
        const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        this.logger.warn(
          `Failed to patch thumbnail status to failed for asset=${assetId}, size=${size}: ${patchMsg}`,
        )
      }

      throw err
    }
  }

  private async generateThumbnail(
    fileId: string,
    assetId: string,
    size: string,
    userId: string,
  ): Promise<void> {
    const dims = STANDARD_SIZES[size]
    if (!dims) throw new Error(`Unknown thumbnail size: ${size}`)
    const [width, height] = dims

    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new Error(`File not found: ${fileId}`)
    const mimeType = record.mimeType

    const tmpPath = join(tmpdir(), `thumb-${randomUUID()}`)
    try {
      await copyFile(this.storage.pathFor(record.storageKey), tmpPath)

      if (mimeType?.startsWith('video/')) {
        let orientation: number | null = null
        let durationSeconds: number | null = null

        // ponytail: thumbnail and metadata jobs race after upload — wait for metadata to land instead of thumbnailing blind (unrotated, frame 0)
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const asset = await this.assetRepo.findOne({ where: { id: assetId } })
            if (!asset) break
            orientation = asset.orientation ?? null
            durationSeconds = asset.durationSeconds !== null ? Number(asset.durationSeconds) : null
            if (asset.metadataStatus !== 'pending') break
          } catch {
            // transient DB error; retry below
          }
          if (attempt < 4) {
            await new Promise((r) => setTimeout(r, 1000))
          }
        }
        const degrees = orientation === null ? 0 : ((orientation % 360) + 360) % 360
        if (durationSeconds === null || !Number.isFinite(durationSeconds)) durationSeconds = 0

        const seekSec =
          durationSeconds > 0
            ? Math.min(Math.max(0, durationSeconds * 0.25), Math.max(0, durationSeconds - 0.1))
            : 0

        const frameBuffer = (
          await runFfmpeg([
            '-y',
            '-noautorotate',
            '-ss',
            String(seekSec),
            '-i',
            tmpPath,
            '-vframes',
            '1',
            '-f',
            'image2pipe',
            '-',
          ])
        ).stdout

        let framePipeline = sharp(frameBuffer)
        if (degrees !== 0) {
          framePipeline = framePipeline.rotate(degrees)
        }
        const { data: thumbBuffer, info } = await framePipeline
          .resize(width, height, RESIZE_OPTIONS[size] ?? { fit: 'inside' })
          .webp({ quality: WEBP_QUALITY[size] ?? 80 })
          .toBuffer({ resolveWithObject: true })

        await this.storeThumbnail(userId, assetId, size, thumbBuffer, info)

        return
      }

      const { data: thumbBuffer, info } = await sharp(tmpPath)
        .resize(width, height, RESIZE_OPTIONS[size] ?? { fit: 'inside' })
        .webp({ quality: WEBP_QUALITY[size] ?? 80 })
        .toBuffer({ resolveWithObject: true })

      await this.storeThumbnail(userId, assetId, size, thumbBuffer, info)
    } finally {
      await unlink(tmpPath).catch(() => undefined)
    }
  }

  private async storeThumbnail(
    userId: string,
    assetId: string,
    size: string,
    thumbBuffer: Buffer,
    info: { width: number; height: number },
  ): Promise<void> {
    const checksum = createHash('sha256').update(thumbBuffer).digest('hex')
    let fileId: string
    const existing = await this.fileRepo.findOne({
      where: { userId, checksumSha256: checksum, purpose: 'original' },
    })
    if (existing) {
      fileId = existing.id
    } else {
      fileId = randomUUID()
      const storageKey = this.storage.buildKey('thumbnail', userId, fileId, 'webp')
      const staging = join(tmpdir(), `thumb-upload-${randomUUID()}.webp`)
      await writeFile(staging, thumbBuffer)
      await this.storage.save(storageKey, staging)
      await this.fileRepo.save(
        this.fileRepo.create({
          id: fileId,
          userId,
          storageKey,
          originalName: `thumb-${size}.webp`,
          mimeType: 'image/webp',
          sizeBytes: thumbBuffer.length,
          checksumSha256: checksum,
          purpose: 'original',
          assetId: null,
        }),
      )
    }

    await this.thumbRepo.upsert(
      [
        {
          assetId,
          size,
          fileId,
          width: info.width,
          height: info.height,
          bytes: thumbBuffer.length,
        },
      ],
      ['assetId', 'size'],
    )

    try {
      await this.assetRepo.update(assetId, { thumbnailStatus: 'ready' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Thumbnail status update failed for asset=${assetId}: ${msg}`)
    }
  }
}
