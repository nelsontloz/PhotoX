import { Readable } from 'stream'
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { MinioService } from '../../storage/minio.service'
import { parseRangeHeader } from '../streaming.util'

export interface HlsStreamResult {
  stream: Readable
  totalSize: number
  range?: { start: number; end: number }
}

@Injectable()
export class HlsFilesService {
  constructor(private readonly minio: MinioService) {}

  async uploadBatch(
    userId: string,
    fileId: string,
    paths: string[],
    files: { originalname: string; buffer: Buffer; mimetype: string; size: number }[],
  ): Promise<void> {
    if (!userId || !fileId || !paths || !files || files.length === 0) {
      throw new BadRequestException('userId, fileId, paths, and files are required')
    }
    if (paths.length !== files.length) {
      throw new BadRequestException('paths and files must have the same length')
    }
    if (files.length > 100) {
      throw new BadRequestException('Too many files (max 100)')
    }
    for (const p of paths) {
      if (p.includes('..') || p.startsWith('/')) {
        throw new BadRequestException(`Invalid path: ${p}`)
      }
    }

    await Promise.all(
      files.map((file, i) => {
        const key = `${userId}/${fileId}/hls/${paths[i]}`
        return this.minio.uploadFile(
          key,
          Readable.from(file.buffer),
          file.buffer.length,
          file.mimetype,
        )
      }),
    )
  }

  async stream(
    userId: string,
    fileId: string,
    relPath: string,
    rangeHeader: string | undefined,
  ): Promise<HlsStreamResult> {
    const key = `${userId}/${fileId}/hls/${relPath}`

    let totalSize: number
    try {
      const stat = await this.minio.statFile(key)
      totalSize = stat.size
    } catch {
      throw new NotFoundException('HLS file not found')
    }

    if (rangeHeader) {
      const range = parseRangeHeader(rangeHeader, totalSize)
      if (!range) {
        throw new BadRequestException('Invalid range')
      }
      const length = range.end - range.start + 1
      const downloadStream = await this.minio.downloadFileRange(key, range.start, length)
      return { stream: downloadStream, totalSize, range }
    }

    const downloadStream = await this.minio.downloadFile(key)
    return { stream: downloadStream, totalSize }
  }
}
