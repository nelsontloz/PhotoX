import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  Req,
  UseInterceptors,
  UploadedFile,
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
import { RegisterFileBodyDto } from './dto/register-file.body.dto'
import { UploadFileBodyDto } from './dto/upload-file.body.dto'
import { parseRangeHeader, pipeFileResponse } from '../streaming.util'

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
    return this.userFilesService.upload((req.user as { id: string }).id, file, {
      kind: body.kind,
      title: body.title,
      description: body.description,
      takenAt: body.takenAt,
    })
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a file whose bytes a worker already wrote to storage' })
  @ApiResponse({ status: 201, description: 'File registered' })
  @ApiResponse({ status: 200, description: 'Existing file returned for the same checksum' })
  @ApiResponse({ status: 400, description: 'Invalid registration payload' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  @ApiResponse({ status: 409, description: 'File id already exists' })
  @ApiResponse({ status: 422, description: 'Bytes missing from storage' })
  async register(
    @Req() req: Request,
    @Body() body: RegisterFileBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = (req.user as { id: string }).id
    const { file, created } = await this.userFilesService.register(userId, body)
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK)
    return file
  }

  @Get(':fileId/stream')
  @ApiOperation({ summary: 'Stream file bytes for video playback (public, capability URL)' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 206, description: 'Partial content' })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async stream(@Param('fileId') fileId: string, @Res() res: Response, @Req() req: Request) {
    const rangeHeader = req.headers.range

    if (rangeHeader) {
      const { totalSize } = await this.userFilesService.getFileStat(fileId)
      const range = parseRangeHeader(rangeHeader, totalSize)
      if (!range) {
        pipeFileResponse(res, { range: null, totalSize })
        return
      }

      const { stream, record } = await this.userFilesService.stream(fileId, { range })
      pipeFileResponse(res, { stream, record, range, totalSize })
      return
    }

    const { stream, record, totalSize } = await this.userFilesService.stream(fileId)
    pipeFileResponse(res, {
      stream,
      record,
      totalSize,
      disposition: `attachment; filename="${record.originalName}"`,
    })
  }

  @Get(':fileId')
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiResponse({ status: 200, description: 'File record', type: FileRecordDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getOne(@Param('fileId') fileId: string, @Req() req: Request) {
    return this.userFilesService.getOne((req.user as { id: string }).id, fileId)
  }

  @Get(':fileId/download')
  @ApiOperation({ summary: 'Download file bytes' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async download(@Res() res: Response, @Param('fileId') fileId: string, @Req() req: Request) {
    const userId = (req.user as { id: string }).id
    const { stream, record } = await this.userFilesService.download(userId, fileId)
    pipeFileResponse(res, {
      stream,
      record,
      disposition: `attachment; filename="${record.originalName}"`,
    })
  }
}
