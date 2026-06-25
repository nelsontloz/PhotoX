import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { HlsFilesService } from './hls-files.service'

const MIME_MAP: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot) : ''
}

@ApiTags('hls-internal')
@Controller('v1/internal/hls/files')
export class HlsFilesController {
  constructor(private readonly hlsFilesService: HlsFilesService) {}

  @Post('batch')
  @UseInterceptors(FilesInterceptor('files', 100))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a batch of HLS segment files' })
  @ApiResponse({ status: 201, description: 'Files uploaded' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async uploadBatch(
    @Body('userId') userId: string,
    @Body('fileId') fileId: string,
    @Body('paths') pathsJson: string,
    @UploadedFiles()
    files: { originalname: string; buffer: Buffer; mimetype: string; size: number }[],
  ) {
    let paths: string[]
    try {
      const parsed = JSON.parse(pathsJson) as unknown
      if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
        throw new BadRequestException('paths must be a JSON array of strings')
      }
      paths = parsed
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      throw new BadRequestException('paths must be a valid JSON array of strings')
    }
    await this.hlsFilesService.uploadBatch(userId, fileId, paths, files ?? [])
    return { uploaded: files?.length ?? 0 }
  }

  @Get(':userId/:fileId/*')
  @ApiOperation({ summary: 'Stream an HLS file or segment' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 206, description: 'Partial content' })
  @ApiResponse({ status: 400, description: 'Invalid range' })
  @ApiResponse({ status: 404, description: 'HLS file not found' })
  async stream(
    @Param('userId') userId: string,
    @Param('fileId') fileId: string,
    @Param('0') relPath: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const rangeHeader = req.headers.range
    const safePath = relPath.replace(/^\/+/, '')

    const result = await this.hlsFilesService.stream(userId, fileId, safePath, rangeHeader)

    const ext = extensionOf(safePath)
    const contentType = MIME_MAP[ext] ?? 'application/octet-stream'

    if (result.range) {
      const { start, end } = result.range
      res.set({
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${result.totalSize}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
      })
      res.status(206)
    } else {
      res.set({
        'Content-Type': contentType,
        'Content-Length': String(result.totalSize),
        'Accept-Ranges': 'bytes',
      })
    }

    result.stream.pipe(res)
  }
}
