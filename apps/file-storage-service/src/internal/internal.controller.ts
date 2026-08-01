import { Controller, Get, Delete, Param, HttpCode, HttpStatus, Logger } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { InjectRepository } from '@nestjs/typeorm'
import { LessThan, Repository } from 'typeorm'
import { FileRecord } from '../entities/file-record.entity'
import { MinioService } from '../storage/minio.service'

const ORPHAN_GRACE_MS = 10 * 60 * 1000

@ApiTags('internal')
@Controller('v1')
export class InternalController {
  private readonly logger = new Logger(InternalController.name)

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly minio: MinioService,
  ) {}

  @Get('file-ids')
  @ApiOperation({ summary: 'List all file record IDs (internal)' })
  async getAllFileIds(): Promise<string[]> {
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS)
    const rows = await this.fileRepo.find({
      select: ['id'],
      where: { createdAt: LessThan(cutoff) },
    })
    return rows.map((r) => r.id)
  }

  @Delete('internal/files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file record and its MinIO object (internal)' })
  async deleteFile(@Param('fileId') fileId: string): Promise<void> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) return
    try {
      await this.minio.deleteFile(record.storageKey)
    } catch (err) {
      this.logger.error(`MinIO delete failed for ${fileId}`, err instanceof Error ? err.stack : undefined)
    }
    await this.fileRepo.remove(record)
  }
}
