import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Readable } from 'stream'
import { createHash, randomUUID } from 'crypto'
import { FileRecord } from '../../entities/file-record.entity'
import { MinioService } from '../../storage/minio.service'
import { toFileRecordResponse } from '../file-record.mapper'
import type { BatchFilesResponse } from '@photox/shared-types'

@Injectable()
export class InternalFilesService {
  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly minio: MinioService,
  ) {}

  async upload(userId: string, file: { buffer: Buffer; originalname: string; mimetype: string }) {
    const checksum = createHash('sha256').update(file.buffer).digest('hex')
    const ext =
      file.originalname.lastIndexOf('.') >= 0
        ? file.originalname.slice(file.originalname.lastIndexOf('.') + 1)
        : 'bin'
    const fileId = randomUUID()
    const storageKey = `${userId}/${fileId}.${ext}`

    await this.minio.uploadFile(
      storageKey,
      Readable.from(file.buffer),
      file.buffer.length,
      file.mimetype,
    )

    const record = this.fileRepo.create({
      userId,
      storageKey,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.length,
      checksumSha256: checksum,
    })
    await this.fileRepo.save(record)

    return toFileRecordResponse(record)
  }

  async getOne(fileId: string) {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    return toFileRecordResponse(record)
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

  async delete(fileId: string): Promise<void> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) return

    try {
      await this.minio.deleteFile(record.storageKey)
    } catch (err) {
      console.error('[InternalFilesService] MinIO delete failed', err)
    }

    await this.fileRepo.remove(record)
  }
}
