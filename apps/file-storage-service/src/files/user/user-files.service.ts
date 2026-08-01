import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID, createHash } from 'crypto'
import { createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { FileRecord } from '../../entities/file-record.entity'
import { MinioService } from '../../storage/minio.service'
import { toFileRecordResponse } from '../file-record.mapper'
import type { FileListResponse } from '@photox/shared-types'

interface UploadedDiskFile {
  path: string
  originalname: string
  mimetype: string
  size: number
}

@Injectable()
export class UserFilesService {
  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly minio: MinioService,
  ) {}

  async upload(userId: string, file: UploadedDiskFile): Promise<FileRecord> {
    return this.storeFile(userId, file, 'original', null)
  }

  async uploadDerivative(
    userId: string,
    assetId: string,
    file: UploadedDiskFile,
  ): Promise<FileRecord> {
    return this.storeFile(userId, file, 'transcode', assetId)
  }

  private async storeFile(
    userId: string,
    file: UploadedDiskFile,
    purpose: 'original' | 'transcode',
    assetId: string | null,
  ): Promise<FileRecord> {
    if (!file) {
      throw new BadRequestException('No file provided')
    }

    const label = purpose === 'transcode' ? 'derivative' : 'file'

    try {
      const checksum = await this.computeChecksum(file.path)

      const existing = await this.fileRepo.findOne({
        where: { userId, checksumSha256: checksum, purpose, ...(assetId ? { assetId } : {}) },
      })
      if (existing) return existing

      const ext = this.getExtension(file.originalname)
      const fileId = randomUUID()
      const storageKey = `${userId}/${fileId}.${ext}`

      try {
        const stream = createReadStream(file.path)
        stream.on('error', () => undefined)
        await this.minio.uploadFile(storageKey, stream, file.size, file.mimetype)
      } catch (err) {
        console.error(`[UserFilesService] MinIO ${label} upload failed`, err)
        throw new BadRequestException(`Failed to upload ${label} to storage`)
      }

      const record = this.fileRepo.create({
        userId,
        storageKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksumSha256: checksum,
        purpose,
        assetId,
      })

      try {
        await this.fileRepo.save(record)
      } catch (err) {
        console.error(`[UserFilesService] DB save failed, cleaning up ${label} object`, err)
        try {
          await this.minio.deleteFile(storageKey)
        } catch (cleanupErr) {
          console.error(
            `[UserFilesService] ${label.charAt(0).toUpperCase()}${label.slice(1)} cleanup failed`,
            cleanupErr,
          )
        }
        throw new BadRequestException(`Failed to save ${label} record`)
      }

      return record
    } finally {
      await unlink(file.path).catch(() => undefined)
    }
  }

  private async computeChecksum(path: string): Promise<string> {
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    return hash.digest('hex')
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

  async getFileStat(fileId: string): Promise<{ totalSize: number }> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    const stat = await this.minio.statFile(record.storageKey)
    return { totalSize: stat.size }
  }

  async getFileUrl(userId: string, fileId: string, ttlSeconds = 300): Promise<string> {
    const record = await this.fileRepo.findOne({ where: { id: fileId, userId } })
    if (!record) throw new NotFoundException('File not found')
    return this.minio.presignedGetUrl(record.storageKey, ttlSeconds)
  }

  private getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.')
    return dot >= 0 ? filename.slice(dot + 1) : 'bin'
  }
}
