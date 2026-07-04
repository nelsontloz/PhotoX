import { Controller, Get, Delete, Param, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { FileRecord } from '../entities/file-record.entity'
import { MinioService } from '../storage/minio.service'

@ApiTags('internal')
@Controller('v1/internal')
export class InternalController {
  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly minio: MinioService,
  ) {}

  @Get('file-ids')
  @ApiOperation({ summary: 'List all file record IDs (internal)' })
  async getAllFileIds(): Promise<string[]> {
    const rows = await this.fileRepo.find({ select: ['id'] })
    return rows.map(r => r.id)
  }

  @Delete('files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file record and its MinIO object (internal)' })
  async deleteFile(@Param('fileId') fileId: string): Promise<void> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) return
    try {
      await this.minio.deleteFile(record.storageKey)
    } catch {
      // ponytail: best-effort minio delete, log if needed later
    }
    await this.fileRepo.remove(record)
  }
}
