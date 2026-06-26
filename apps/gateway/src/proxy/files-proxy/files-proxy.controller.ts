import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { firstValueFrom } from 'rxjs'
import { ProxyService } from '../proxy.service'
import { SERVICE_URLS } from '@photox/shared-config'
import { ThumbnailOrchestratorService } from '../../orchestrator/thumbnail-orchestrator.service'
import { VideoOrchestratorService } from '../../orchestrator/video-orchestrator.service'
import type { FileListResponse, FileRecord, Asset } from '@photox/shared-types'

@ApiTags('files')
@Controller('api/v1/files')
export class FilesProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly http: HttpService,
    private readonly thumbnails: ThumbnailOrchestratorService,
    private readonly videoTranscode: VideoOrchestratorService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file and create an asset' })
  @ApiResponse({ status: 201, description: 'File uploaded and asset created' })
  @ApiResponse({ status: 400, description: 'No file or invalid request' })
  @ApiResponse({ status: 502, description: 'Upstream server error' })
  async upload(
    @Req() req: Request,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    const userId = (req.user as { id: string }).id
    const requestId = (req.headers['x-request-id'] as string) ?? ''

    const kindFromClient = (req.body as { kind?: string }).kind
    let kind: 'photo' | 'video' | undefined
    if (kindFromClient === 'photo' || kindFromClient === 'video') {
      kind = kindFromClient
    } else if (file.mimetype.startsWith('image/')) {
      kind = 'photo'
    } else if (file.mimetype.startsWith('video/')) {
      kind = 'video'
    }

    if (!kind) {
      throw new BadRequestException(
        'Invalid or missing kind. Provide kind as form field or ensure file is image/video',
      )
    }

    const title = (req.body as { title?: string }).title
    const description = (req.body as { description?: string }).description
    const takenAt = (req.body as { takenAt?: string }).takenAt

    const form = new FormData()
    form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname)
    form.append('userId', userId)

    const fileResult = await this.proxy.forward<FileRecord>(SERVICE_URLS['file-storage-service'], {
      method: 'POST',
      path: 'v1/files',
      body: form,
      headers: {
        'x-request-id': requestId,
      },
      timeout: 180_000,
    })

    const record = fileResult.data

    let existingAssetExists = false
    let existingAssetId: string | undefined
    try {
      const existingAsset = await this.proxy.forward<Asset>(SERVICE_URLS['media-service'], {
        method: 'GET',
        path: `v1/assets/by-file/${record.id}`,
        headers: { 'x-request-id': requestId },
        timeout: 5_000,
      })
      existingAssetExists = true
      existingAssetId = existingAsset.data.id
    } catch (checkErr) {
      const status =
        typeof (checkErr as { getStatus?: () => number }).getStatus === 'function'
          ? (checkErr as { getStatus: () => number }).getStatus()
          : (checkErr as { status?: number }).status
      if (status !== 404) {
        throw checkErr
      }
    }

    if (existingAssetExists) {
      throw new ConflictException({
        statusCode: 409,
        message: 'File already uploaded',
        existingAssetId,
        existingFileId: record.id,
      })
    }

    try {
      const assetResult = await this.proxy.forward<Asset>(SERVICE_URLS['media-service'], {
        method: 'POST',
        path: 'v1/assets',
        body: {
          fileId: record.id,
          kind,
          title,
          description,
          takenAt,
          userId,
        },
        headers: {
          'x-request-id': requestId,
        },
        timeout: 5_000,
      })
      void this.thumbnails.enqueueThumbnails(assetResult.data.id, record.id, userId)
      if (kind === 'video') {
        void this.videoTranscode.enqueueVideo(assetResult.data.id, record.id, userId)
      }
      return assetResult.data
    } catch (assetErr) {
      try {
        await this.proxy.forward(SERVICE_URLS['file-storage-service'], {
          method: 'DELETE',
          path: `v1/files/${record.id}`,
          query: { userId },
          headers: {
            'x-request-id': requestId,
          },
          timeout: 5_000,
        })
      } catch (deleteErr) {
        console.error(
          '[FilesProxyController] Compensation delete failed for fileId',
          record.id,
          deleteErr,
        )
      }
      throw assetErr
    }
  }

  @Get()
  @ApiOperation({ summary: 'List files with filters' })
  @ApiResponse({ status: 200, description: 'Paginated file list' })
  async list(
    @Query() q: Record<string, string | undefined>,
    @Req() req: Request,
  ): Promise<FileListResponse> {
    const result = await this.proxy.forward<FileListResponse>(
      SERVICE_URLS['file-storage-service'],
      {
        method: 'GET',
        path: 'v1/files',
        query: { ...q, userId: (req.user as { id: string }).id },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 30_000,
      },
    )
    return result.data
  }

  @Get(':fileId')
  @ApiOperation({ summary: 'Get a single file record' })
  @ApiResponse({ status: 200, description: 'File record found' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getOne(@Param('fileId') fileId: string, @Req() req: Request): Promise<FileRecord> {
    const result = await this.proxy.forward<FileRecord>(SERVICE_URLS['file-storage-service'], {
      method: 'GET',
      path: `v1/files/${fileId}`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Get(':fileId/download')
  @ApiOperation({ summary: 'Download file bytes' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async download(@Param('fileId') fileId: string, @Req() req: Request, @Res() res: Response) {
    const url = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/download`
    const upstream = await firstValueFrom(
      this.http.get(url, {
        responseType: 'arraybuffer',
        params: { userId: (req.user as { id: string }).id },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 30_000,
        validateStatus: () => true,
      }),
    )
    if (upstream.status >= 400) {
      res.status(upstream.status).json({ statusCode: upstream.status, message: 'File not found' })
      return
    }
    const buf = Buffer.from(upstream.data as ArrayBuffer)
    res.set({
      'Content-Type': upstream.headers['content-type'] as string,
      'Content-Length': String(buf.byteLength),
    })
    res.send(buf)
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file (idempotent)' })
  @ApiResponse({ status: 204, description: 'File deleted' })
  async delete(@Param('fileId') fileId: string, @Req() req: Request): Promise<void> {
    await this.proxy.forward(SERVICE_URLS['file-storage-service'], {
      method: 'DELETE',
      path: `v1/files/${fileId}`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
  }
}
