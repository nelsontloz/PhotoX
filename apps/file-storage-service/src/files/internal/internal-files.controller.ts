import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Res,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Response } from 'express'
import { InternalFilesService } from './internal-files.service'
import { FileRecordDto } from '../file-record.dto'
import { BatchFilesRequestDto, BatchFilesResponseDto } from './dto/batch-files.dto'

@ApiTags('internal-files')
@Controller('v1/internal/files')
export class InternalFilesController {
  constructor(private readonly internalFilesService: InternalFilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file (service-to-service)' })
  @ApiResponse({ status: 201, type: FileRecordDto })
  async upload(
    @Body('userId') userId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.internalFilesService.upload(userId, file)
  }

  @Get(':fileId')
  @ApiOperation({ summary: 'Get file record (service-to-service)' })
  @ApiResponse({ status: 200, description: 'File record', type: FileRecordDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getOne(@Param('fileId') fileId: string) {
    return this.internalFilesService.getOne(fileId)
  }

  @Post('batch')
  @ApiOperation({ summary: 'Get multiple file records (service-to-service)' })
  @ApiResponse({ status: 200, description: 'Found and missing files', type: BatchFilesResponseDto })
  async getBatch(@Body() dto: BatchFilesRequestDto) {
    return this.internalFilesService.getBatch(dto.fileIds)
  }

  @Get(':fileId/stream')
  @ApiOperation({ summary: 'Stream file bytes (service-to-service)' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async stream(@Param('fileId') fileId: string, @Res() res: Response) {
    const { stream, record } = await this.internalFilesService.stream(fileId)
    res.set({
      'Content-Type': record.mimeType,
      'Content-Disposition': `attachment; filename="${record.originalName}"`,
    })
    stream.pipe(res)
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete file (service-to-service, cascading)' })
  @ApiResponse({ status: 204, description: 'File deleted' })
  async delete(@Param('fileId') fileId: string) {
    await this.internalFilesService.delete(fileId)
  }
}
