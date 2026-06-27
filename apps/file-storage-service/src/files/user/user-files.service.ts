import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID, createHash } from 'crypto'
import { Readable } from 'stream'
import { FileRecord } from '../../entities/file-record.entity'
import { MinioService } from '../../storage/minio.service'
import { toFileRecordResponse } from '../file-record.mapper'
import type { FileListResponse, BatchFilesResponse } from '@photox/shared-types'

@Injectable()
export class UserFilesService {
  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly minio: MinioService,
  ) {}

  async upload(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<FileRecord> {
    if (!file) {
      throw new BadRequestException('No file provided')
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex')

    const existing = await this.fileRepo.findOne({
      where: { userId, checksumSha256: checksum, purpose: 'original' },
    })
    if (existing) return existing

    const ext = this.getExtension(file.originalname)
    const fileId = randomUUID()
    const storageKey = `${userId}/${fileId}.${ext}`

    try {
      await this.minio.uploadFile(
        storageKey,
        Readable.from(file.buffer),
        file.buffer.length,
        file.mimetype,
      )
    } catch (err) {
      console.error('[UserFilesService] MinIO upload failed', err)
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
      console.error('[UserFilesService] DB save failed, cleaning up MinIO object', err)
      try {
        await this.minio.deleteFile(storageKey)
      } catch (cleanupErr) {
        console.error('[UserFilesService] Orphan cleanup failed', cleanupErr)
      }
      throw new BadRequestException('Failed to save file record')
    }

    return record
  }

  async list(userId: string, limit = 20, offset = 0, mimeType?: string): Promise<FileListResponse> {
    const qb = this.fileRepo
      .createQueryBuilder('f')
      .where('f.userId = :userId', { userId })
      .andWhere('f.purpose = :purpose', { purpose: 'original' })

    if (mimeType) {
      qb.andWhere('f.mimeType LIKE :mimeType', { mimeType: `${mimeType}%` })
    }

    const [items, total] = await qb
      .orderBy('f.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getManyAndCount()

    return {
      items: items.map((f) => ({
        id: f.id,
        userId: f.userId,
        originalName: f.originalName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    }
  }

  async uploadDerivative(
    userId: string,
    assetId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<FileRecord> {
    if (!file) {
      throw new BadRequestException('No file provided')
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex')

    const existing = await this.fileRepo.findOne({
      where: { userId, checksumSha256: checksum, assetId, purpose: 'transcode' },
    })
    if (existing) return existing

    const ext = this.getExtension(file.originalname)
    const fileId = randomUUID()
    const storageKey = `${userId}/${fileId}.${ext}`

    try {
      await this.minio.uploadFile(
        storageKey,
        Readable.from(file.buffer),
        file.buffer.length,
        file.mimetype,
      )
    } catch (err) {
      console.error('[UserFilesService] MinIO derivative upload failed', err)
      throw new BadRequestException('Failed to upload derivative to storage')
    }

    const record = this.fileRepo.create({
      userId,
      storageKey,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      checksumSha256: checksum,
      purpose: 'transcode',
      assetId,
    })

    try {
      await this.fileRepo.save(record)
    } catch (err) {
      console.error('[UserFilesService] DB save failed, cleaning up derivative object', err)
      try {
        await this.minio.deleteFile(storageKey)
      } catch (cleanupErr) {
        console.error('[UserFilesService] Derivative cleanup failed', cleanupErr)
      }
      throw new BadRequestException('Failed to save derivative record')
    }

    return record
  }

  async deleteByAsset(userId: string, assetId: string): Promise<void> {
    // ponytail: cascade from media-service asset hard-delete — caller wires later
    const records = await this.fileRepo.find({
      where: { userId, assetId, purpose: 'transcode' as const },
    })

    for (const record of records) {
      try {
        await this.minio.deleteFile(record.storageKey)
      } catch (err) {
        console.error('[UserFilesService] MinIO derivative delete failed', err)
      }
    }

    if (records.length > 0) {
      await this.fileRepo.remove(records)
    }
  }

  async getOne(userId: string, fileId: string) {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    if (record.userId !== userId) throw new NotFoundException('File not found')
    return toFileRecordResponse(record)
  }

  async download(
    userId: string,
    fileId: string,
  ): Promise<{ stream: Readable; record: FileRecord }> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    if (record.userId !== userId) throw new NotFoundException('File not found')
    const stream = await this.minio.downloadFile(record.storageKey)
    return { stream, record }
  }

  async delete(userId: string, fileId: string): Promise<void> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) return
    if (record.userId !== userId) return

    try {
      await this.minio.deleteFile(record.storageKey)
    } catch (err) {
      console.error('[UserFilesService] MinIO delete failed', err)
    }

    await this.fileRepo.remove(record)
  }

  async getBatch(fileIds: string[]): Promise<BatchFilesResponse> {
    if (fileIds.length === 0) return { items: [], missing: [] }

    const found = await this.fileRepo
      .createQueryBuilder('f')
      .where('f.id IN (:...fileIds)', { fileIds })
      .getMany()

    const foundIds = new Set(found.map((f) => f.id))
    const missing = fileIds.filter((id) => !foundIds.has(id))

    return {
      items: found.map((f) => toFileRecordResponse(f)),
      missing,
    }
  }

  async stream(
    fileId: string,
    opts?: { range: { start: number; end: number } },
  ): Promise<{ stream: Readable; record: FileRecord; totalSize: number }> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    const stat = await this.minio.statFile(record.storageKey)
    const totalSize = stat.size

    if (opts) {
      const length = opts.range.end - opts.range.start + 1
      const stream = await this.minio.downloadFileRange(record.storageKey, opts.range.start, length)
      return { stream, record, totalSize }
    }

    const stream = await this.minio.downloadFile(record.storageKey)
    return { stream, record, totalSize }
  }

  async getFileUrl(userId: string, fileId: string, ttlSeconds = 300): Promise<string> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    void userId
    return this.minio.presignedGetUrl(record.storageKey, ttlSeconds)
  }

  private getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.')
    return dot >= 0 ? filename.slice(dot + 1) : 'bin'
  }
}
