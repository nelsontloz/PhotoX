import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  Req,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { UserFilesService } from './user-files.service'
import { FileRecordDto } from '../file-record.dto'
import { FileListResponseDto, ListFilesQueryDto } from './dto/list-files-query.dto'
import { parseRangeHeader } from '../streaming.util'

@ApiTags('files')
@Controller('v1/files')
export class UserFilesController {
  constructor(private readonly userFilesService: UserFilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 4 * 1024 * 1024 * 1024 } }))
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
  @ApiResponse({ status: 200, description: 'Found and missing files' })
  async getBatch(@Body() dto: { fileIds: string[] }) {
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

  @Post(':fileId/replace')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 4 * 1024 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Replace a file' })
  @ApiResponse({ status: 200, description: 'File replaced', type: FileRecordDto })
  @ApiResponse({ status: 400, description: 'No file or invalid request' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async replace(
    @Param('fileId') fileId: string,
    @Query('userId') userId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    return this.userFilesService.replace(userId, fileId, file)
  }

  @Get(':fileId/stream')
  @ApiOperation({ summary: 'Stream file bytes' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 206, description: 'Partial content' })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async stream(@Param('fileId') fileId: string, @Res() res: Response, @Req() req: Request) {
    const rangeHeader = req.headers.range

    if (rangeHeader) {
      const preflight = await this.userFilesService.stream(fileId)
      const totalSize = preflight.totalSize

      const range = parseRangeHeader(rangeHeader, totalSize)
      if (!range) {
        res.set('Content-Range', `bytes */${totalSize}`)
        res.status(416).end()
        return
      }

      const { stream, record } = await this.userFilesService.stream(fileId, { range })

      res.set({
        'Content-Type': record.mimeType,
        'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
        'Content-Length': String(range.end - range.start + 1),
        'Accept-Ranges': 'bytes',
      })
      res.status(206)
      stream.pipe(res)
      return
    }

    const { stream, record } = await this.userFilesService.stream(fileId)
    res.set({
      'Content-Type': record.mimeType,
      'Content-Disposition': `attachment; filename="${record.originalName}"`,
      'Accept-Ranges': 'bytes',
    })
    stream.pipe(res)
  }

  @Get(':fileId/url')
  @ApiOperation({ summary: 'Get a short-lived presigned URL for a file' })
  @ApiResponse({ status: 200, description: 'Presigned URL' })
  @ApiResponse({ status: 400, description: 'Invalid TTL' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getPresignedUrl(
    @Param('fileId') fileId: string,
    @Query('userId') userId: string,
    @Query('ttl') ttl?: string,
  ) {
    const ttlSeconds = ttl ? Number(ttl) : 300
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
      throw new BadRequestException('TTL must be between 1 and 3600 seconds')
    }
    const url = await this.userFilesService.getFileUrl(userId, fileId, ttlSeconds)
    return { url, expiresAt: Date.now() + ttlSeconds * 1000 }
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
