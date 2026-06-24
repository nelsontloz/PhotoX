import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
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
import { UserFilesService } from './user-files.service'
import { FileRecordDto } from '../file-record.dto'
import { FileListResponseDto, ListFilesQueryDto } from './dto/list-files-query.dto'
import { BatchFilesRequestDto, BatchFilesResponseDto } from './dto/batch-files.dto'

@ApiTags('files')
@Controller('v1/files')
export class UserFilesController {
  constructor(private readonly userFilesService: UserFilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file' })
  @ApiResponse({ status: 201, description: 'File uploaded', type: FileRecordDto })
  @ApiResponse({ status: 400, description: 'No file or invalid request' })
  async upload(
    @Body('userId') userId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    return this.userFilesService.upload(userId, file)
  }

  @Post('batch')
  @ApiOperation({ summary: 'Get multiple file records' })
  @ApiResponse({ status: 200, description: 'Found and missing files', type: BatchFilesResponseDto })
  async getBatch(@Body() dto: BatchFilesRequestDto) {
    return this.userFilesService.getBatch(dto.fileIds)
  }

  @Get()
  @ApiOperation({ summary: "List the authenticated user's files" })
  @ApiResponse({ status: 200, description: 'Paginated file list', type: FileListResponseDto })
  async list(@Query() query: ListFilesQueryDto) {
    return this.userFilesService.list(
      query.userId,
      query.limit ?? 20,
      query.offset ?? 0,
      query.mimeType,
    )
  }

  @Get(':fileId/stream')
  @ApiOperation({ summary: 'Stream file bytes' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async stream(@Param('fileId') fileId: string, @Res() res: Response) {
    const { stream, record } = await this.userFilesService.stream(fileId)
    res.set({
      'Content-Type': record.mimeType,
      'Content-Disposition': `attachment; filename="${record.originalName}"`,
    })
    stream.pipe(res)
  }

  @Get(':fileId')
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiResponse({ status: 200, description: 'File record', type: FileRecordDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getOne(@Param('fileId') fileId: string, @Query('userId') userId: string) {
    return this.userFilesService.getOne(userId, fileId)
  }

  @Get(':fileId/download')
  @ApiOperation({ summary: 'Download file bytes' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async download(
    @Res() res: Response,
    @Param('fileId') fileId: string,
    @Query('userId') userId: string,
  ) {
    const { stream, record } = await this.userFilesService.download(userId, fileId)
    res.set({
      'Content-Type': record.mimeType,
      'Content-Disposition': `attachment; filename="${record.originalName}"`,
    })
    stream.pipe(res)
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file (idempotent)' })
  @ApiResponse({ status: 204, description: 'File deleted' })
  async delete(@Param('fileId') fileId: string, @Query('userId') userId: string) {
    await this.userFilesService.delete(userId, fileId)
  }
}
