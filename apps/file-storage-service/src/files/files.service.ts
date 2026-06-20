import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID, createHash } from 'crypto'
import { Readable } from 'stream'
import { RedisService } from '@photox/shared-redis'
import { EVENTS, type FileUploadedEvent, type FileDeletedEvent } from '@photox/shared-events'
import { FileRecord } from '../entities/file-record.entity'
import { MinioService } from '../storage/minio.service'
import type { FileListResponse, BatchFilesResponse } from '@photox/shared-types'

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly minio: MinioService,
    private readonly redis: RedisService,
  ) {}

  async upload(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<FileRecord> {
    if (!file) {
      throw new BadRequestException('No file provided')
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex')
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
      console.error('[FilesService] MinIO upload failed', err)
      throw new BadRequestException('Failed to upload file to storage')
    }

    const record = this.fileRepo.create({
      userId,
      storageKey,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      checksumSha256: checksum,
    })

    try {
      await this.fileRepo.save(record)
    } catch (err) {
      console.error('[FilesService] DB save failed, cleaning up MinIO object', err)
      try {
        await this.minio.deleteFile(storageKey)
      } catch (cleanupErr) {
        console.error('[FilesService] Orphan cleanup failed', cleanupErr)
      }
      throw new BadRequestException('Failed to save file record')
    }

    this.publishEvent(EVENTS.FILE_UPLOADED, {
      fileId: record.id,
      userId: record.userId,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      timestamp: new Date().toISOString(),
    } satisfies FileUploadedEvent)

    return record
  }

  async list(
    userId: string,
    limit = 20,
    offset = 0,
    mimeType?: string,
  ): Promise<FileListResponse> {
    const qb = this.fileRepo.createQueryBuilder('f').where('f.userId = :userId', { userId })

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

  async getOne(userId: string, fileId: string) {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    if (record.userId !== userId) throw new NotFoundException('File not found')
    return this.toResponse(record)
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
      console.error('[FilesService] MinIO delete failed', err)
    }

    await this.fileRepo.remove(record)

    this.publishEvent(EVENTS.FILE_DELETED, {
      fileId: record.id,
      userId: record.userId,
      timestamp: new Date().toISOString(),
    } satisfies FileDeletedEvent)
  }

  async getOneInternal(fileId: string) {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    return this.toResponse(record)
  }

  async getBatchInternal(fileIds: string[]): Promise<BatchFilesResponse> {
    if (fileIds.length === 0) return { items: [], missing: [] }

    const found = await this.fileRepo
      .createQueryBuilder('f')
      .where('f.id IN (:...fileIds)', { fileIds })
      .getMany()

    const foundIds = new Set(found.map((f) => f.id))
    const missing = fileIds.filter((id) => !foundIds.has(id))

    return {
      items: found.map((f) => this.toResponse(f)),
      missing,
    }
  }

  async streamInternal(
    fileId: string,
  ): Promise<{ stream: Readable; record: FileRecord }> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    const stream = await this.minio.downloadFile(record.storageKey)
    return { stream, record }
  }

  async deleteInternal(fileId: string): Promise<void> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) return

    try {
      await this.minio.deleteFile(record.storageKey)
    } catch (err) {
      console.error('[FilesService] MinIO delete failed', err)
    }

    await this.fileRepo.remove(record)

    this.publishEvent(EVENTS.FILE_DELETED, {
      fileId: record.id,
      userId: record.userId,
      timestamp: new Date().toISOString(),
    } satisfies FileDeletedEvent)
  }

  private toResponse(record: FileRecord) {
    return {
      id: record.id,
      userId: record.userId,
      storageKey: record.storageKey,
      originalName: record.originalName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      checksumSha256: record.checksumSha256,
      createdAt: record.createdAt.toISOString(),
    }
  }

  private getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.')
    return dot >= 0 ? filename.slice(dot + 1) : 'bin'
  }

  private publishEvent(channel: string, payload: unknown): void {
    this.redis.publish(channel, JSON.stringify(payload)).catch((err) => {
      console.error(`[FilesService] Failed to publish ${channel}`, err)
    })
  }
}
