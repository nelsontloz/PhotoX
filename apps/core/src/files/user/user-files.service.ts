import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID, createHash } from 'crypto'
import { createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { extname } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { Asset, FileRecord } from '../../database/entities'
import { LocalStorageService } from '@photox/shared-config'
import { toFileRecordResponse } from '../file-record.mapper'
import { RegisterFileBodyDto } from './dto/register-file.body.dto'
import { AssetsService } from '../../assets/assets.service'
import { BullMqService } from '../../queue/bullmq.service'
import { SettingsService } from '../../settings/settings.service'
import type { Asset as AssetResponse } from '@photox/shared-types'

interface UploadedDiskFile {
  path: string
  originalname: string
  mimetype: string
  size: number
}

export interface UploadMeta {
  kind?: 'photo' | 'video'
  title?: string
  description?: string
  takenAt?: string
}

@Injectable()
export class UserFilesService {
  private readonly logger = new Logger(UserFilesService.name)

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly storage: LocalStorageService,
    private readonly assets: AssetsService,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
  ) {}

  async upload(
    userId: string,
    file: UploadedDiskFile,
    meta: UploadMeta = {},
  ): Promise<AssetResponse> {
    if (!file) {
      throw new BadRequestException('No file provided')
    }
    const { record, created } = await this.storeFile(userId, file)
    const kind = meta.kind ?? this.kindFromMime(file.mimetype)
    if (!kind) {
      throw new BadRequestException('Unsupported file type')
    }
    if (!created) {
      const existing = await this.assets.getByFileId(record.id, userId).catch((err: unknown) => {
        if (err instanceof NotFoundException) return null
        throw err
      })
      if (existing) {
        throw new ConflictException({
          existingAssetId: existing.id,
          existingFileId: record.id,
        })
      }
    }
    const asset = await this.assets.create(userId, {
      fileId: record.id,
      kind,
      title: meta.title,
      description: meta.description,
      takenAt: meta.takenAt,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      originalName: file.originalname,
    })
    this.bullMq.enqueueThumbnails(asset.id, record.id, userId)
    void this.bullMq.enqueue('process-metadata', 'process-metadata', {
      assetId: asset.id,
      fileId: record.id,
      userId,
      kind,
    })
    if (kind === 'photo') {
      // ponytail: detector stamped at enqueue time — a later admin switch only affects new uploads;
      // the read is best-effort so a settings outage never fails an upload whose rows already exist
      const detector = await this.settings.getFaceDetector().catch((err: unknown) => {
        this.logger.warn(
          `Face detector setting unavailable, using env default: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        return this.settings.envDefaultDetector()
      })
      void this.bullMq.enqueue('process-faces', 'process-faces', {
        assetId: asset.id,
        fileId: record.id,
        userId,
        detector,
      })
      // videos out of scope for vision search — only photos get image embeddings
      this.bullMq.enqueueEmbedding(asset.id, record.id, userId)
      this.bullMq.enqueueOcr(asset.id, record.id, userId)
    } else {
      this.bullMq.enqueueVideo(asset.id, record.id, userId)
    }
    return asset
  }

  // ponytail: workers write bytes first, then register the row; core recomputes the
  // storageKey from (kind, user, id, ext) so a client can never point at another user's bytes
  async register(
    userId: string,
    dto: RegisterFileBodyDto,
  ): Promise<{ file: ReturnType<typeof toFileRecordResponse>; created: boolean }> {
    const purpose = dto.kind === 'transcode' ? 'transcode' : 'original'
    const existing = await this.fileRepo.findOne({
      where: {
        userId,
        checksumSha256: dto.checksumSha256,
        purpose,
        ...(dto.assetId ? { assetId: dto.assetId } : {}),
      },
    })
    if (existing) return { file: toFileRecordResponse(existing), created: false }

    if (await this.fileRepo.exists({ where: { id: dto.id } })) {
      throw new ConflictException('File id already exists')
    }

    if (dto.assetId) {
      const asset = await this.assetRepo.findOne({ where: { id: dto.assetId, userId } })
      if (!asset) throw new NotFoundException('Asset not found')
    }

    const storageKey = this.storage.buildKey(dto.kind, userId, dto.id, dto.ext)
    if (!(await this.storage.exists(storageKey))) {
      throw new UnprocessableEntityException('File bytes not found in storage')
    }

    const record = this.fileRepo.create({
      id: dto.id,
      userId,
      storageKey,
      originalName: dto.originalName,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      checksumSha256: dto.checksumSha256,
      purpose,
      assetId: dto.assetId ?? null,
    })
    await this.fileRepo.save(record)
    return { file: toFileRecordResponse(record), created: true }
  }

  private kindFromMime(mimetype: string): 'photo' | 'video' | null {
    if (mimetype.startsWith('image/')) return 'photo'
    if (mimetype.startsWith('video/')) return 'video'
    return null
  }

  private async storeFile(
    userId: string,
    file: UploadedDiskFile,
  ): Promise<{ record: FileRecord; created: boolean }> {
    if (!file) {
      throw new BadRequestException('No file provided')
    }

    try {
      const checksum = await this.computeChecksum(file.path)

      const existing = await this.fileRepo.findOne({
        where: { userId, checksumSha256: checksum, purpose: 'original' },
      })
      if (existing) return { record: existing, created: false }

      const ext = extname(file.originalname).slice(1) || 'bin'
      const fileId = randomUUID()
      const storageKey = this.storage.buildKey('original', userId, fileId, ext)

      try {
        await this.storage.save(storageKey, file.path)
      } catch (err) {
        console.error('[UserFilesService] Local storage file save failed', err)
        throw new BadRequestException('Failed to upload file to storage')
      }

      const record = this.fileRepo.create({
        userId,
        storageKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksumSha256: checksum,
        purpose: 'original',
        assetId: null,
      })

      try {
        await this.fileRepo.save(record)
      } catch (err) {
        console.error('[UserFilesService] DB save failed, cleaning up file object', err)
        try {
          await this.storage.delete(storageKey)
        } catch (cleanupErr) {
          console.error('[UserFilesService] File cleanup failed', cleanupErr)
        }
        throw new BadRequestException('Failed to save file record')
      }

      return { record, created: true }
    } finally {
      await unlink(file.path).catch(() => undefined)
    }
  }

  private async computeChecksum(path: string): Promise<string> {
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    return hash.digest('hex')
  }

  private async getRecord(fileId: string): Promise<FileRecord> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    return record
  }

  async getOne(userId: string, fileId: string) {
    const record = await this.getRecord(fileId)
    if (record.userId !== userId) throw new NotFoundException('File not found')
    return toFileRecordResponse(record)
  }

  async download(
    userId: string,
    fileId: string,
  ): Promise<{ stream: Readable; record: FileRecord }> {
    const record = await this.getRecord(fileId)
    if (record.userId !== userId) throw new NotFoundException('File not found')
    const stream = this.storage.createReadStream(record.storageKey)
    return { stream, record }
  }

  async stream(
    fileId: string,
    opts?: { range: { start: number; end: number } },
  ): Promise<{ stream: Readable; record: FileRecord; totalSize: number }> {
    const record = await this.getRecord(fileId)
    const fileStat = await this.storage.stat(record.storageKey)
    const totalSize = fileStat.size

    if (opts) {
      const stream = this.storage.createReadStream(record.storageKey, {
        start: opts.range.start,
        end: opts.range.end,
      })
      return { stream, record, totalSize }
    }

    const stream = this.storage.createReadStream(record.storageKey)
    return { stream, record, totalSize }
  }

  async getFileStat(fileId: string): Promise<{ totalSize: number }> {
    const record = await this.getRecord(fileId)
    const fileStat = await this.storage.stat(record.storageKey)
    return { totalSize: fileStat.size }
  }
}
