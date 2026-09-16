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
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import multer from 'multer'
import { UserFilesService } from './user-files.service'
import { FileRecordDto } from '../file-record.dto'
import { FileListResponseDto, ListFilesQueryDto } from './dto/list-files-query.dto'
import { UploadFileBodyDto } from './dto/upload-file.body.dto'
import { parseRangeHeader } from '../streaming.util'
import { Public } from '../../auth/public.decorator'

const diskStorage = multer.diskStorage({
  destination: tmpdir(),
  filename: (_req, _file, cb) => cb(null, randomUUID()),
})

const uploadOptions = { storage: diskStorage, limits: { fileSize: 4 * 1024 * 1024 * 1024 } }

@ApiTags('files')
@Controller('api/v1/files')
export class UserFilesController {
  constructor(private readonly userFilesService: UserFilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file, create its asset and enqueue processing' })
  @ApiResponse({ status: 201, description: 'File uploaded, asset created' })
  @ApiResponse({ status: 400, description: 'No file or invalid request' })
  @ApiResponse({ status: 409, description: 'File already uploaded' })
  async upload(
    @Req() req: Request,
    @UploadedFile() file: { path: string; originalname: string; mimetype: string; size: number },
    @Body() body: UploadFileBodyDto,
  ) {
    const userId = (req.user as { id: string }).id ?? body.userId
    return this.userFilesService.upload(userId, file, {
      kind: body.kind,
      title: body.title,
      description: body.description,
      takenAt: body.takenAt,
    })
  }

  @Get()
  @ApiOperation({ summary: "List the authenticated user's files" })
  @ApiResponse({ status: 200, description: 'Paginated file list', type: FileListResponseDto })
  async list(@Query() query: ListFilesQueryDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id ?? query.userId
    return this.userFilesService.list(
      userId,
      query.limit ?? 20,
      query.offset ?? 0,
      query.mimeType,
    )
  }

  @Public()
  @Get(':fileId/stream')
  @ApiOperation({ summary: 'Stream file bytes for video playback (public, capability URL)' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 206, description: 'Partial content' })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async stream(
    @Param('fileId') fileId: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const rangeHeader = req.headers.range

    if (rangeHeader) {
      const { totalSize } = await this.userFilesService.getFileStat(fileId)

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
      stream.on('error', () => {
        res.destroy()
      })
      res.on('close', () => {
        stream.destroy()
      })
      stream.pipe(res)
      return
    }

    const { stream, record, totalSize } = await this.userFilesService.stream(fileId)
    res.set({
      'Content-Type': record.mimeType,
      'Content-Length': String(totalSize),
      'Content-Disposition': `attachment; filename="${record.originalName}"`,
      'Accept-Ranges': 'bytes',
    })
    stream.on('error', () => {
      res.destroy()
    })
    res.on('close', () => {
      stream.destroy()
    })
    stream.pipe(res)
  }

  @Get(':fileId')
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiResponse({ status: 200, description: 'File record', type: FileRecordDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getOne(
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Query('userId') queryUserId?: string,
  ) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    return this.userFilesService.getOne(userId, fileId)
  }

  @Get(':fileId/download')
  @ApiOperation({ summary: 'Download file bytes' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async download(
    @Res() res: Response,
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Query('userId') queryUserId?: string,
  ) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    const { stream, record } = await this.userFilesService.download(userId, fileId)
    res.set({
      'Content-Type': record.mimeType,
      'Content-Disposition': `attachment; filename="${record.originalName}"`,
    })
    stream.on('error', () => {
      res.destroy()
    })
    res.on('close', () => {
      stream.destroy()
    })
    stream.pipe(res)
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file (idempotent)' })
  @ApiResponse({ status: 204, description: 'File deleted' })
  async delete(
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Query('userId') queryUserId?: string,
  ) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    await this.userFilesService.delete(userId, fileId)
  }
}
