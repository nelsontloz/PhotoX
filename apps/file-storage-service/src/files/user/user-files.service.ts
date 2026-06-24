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
      where: { userId, checksumSha256: checksum },
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

  async stream(fileId: string): Promise<{ stream: Readable; record: FileRecord }> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    const stream = await this.minio.downloadFile(record.storageKey)
    return { stream, record }
  }

  private getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.')
    return dot >= 0 ? filename.slice(dot + 1) : 'bin'
  }
}
