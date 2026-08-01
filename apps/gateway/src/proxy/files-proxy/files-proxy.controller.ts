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
  BadGatewayException,
  ConflictException,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { firstValueFrom } from 'rxjs'
import { randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { tmpdir } from 'os'
import type { Readable } from 'stream'
import FormData from 'form-data'
import { diskStorage } from 'multer'
import { ProxyService } from '../proxy.service'
import { SERVICE_URLS } from '@photox/shared-config'
import { BullMqService } from '../../queue/bullmq.service'
import { Public } from '../../auth/public.decorator'
import type { FileListResponse, FileRecord, Asset } from '@photox/shared-types'

const tmpStorage = diskStorage({
  destination: tmpdir(),
  filename: (_req, _file, cb) => cb(null, randomUUID()),
})

@ApiTags('files')
@Controller('api/v1/files')
export class FilesProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly http: HttpService,
    private readonly bullmq: BullMqService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { storage: tmpStorage, limits: { fileSize: 4 * 1024 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file and create an asset' })
  @ApiResponse({ status: 201, description: 'File uploaded and asset created' })
  @ApiResponse({ status: 400, description: 'No file or invalid request' })
  @ApiResponse({ status: 502, description: 'Upstream server error' })
  async upload(
    @Req() req: Request,
    @UploadedFile() file: { path: string; originalname: string; mimetype: string },
  ) {
    const userId = (req.user as { id: string }).id
    const requestId = (req.headers['x-request-id'] as string) ?? ''

    const title = (req.body as { title?: string }).title
    const description = (req.body as { description?: string }).description
    const takenAt = (req.body as { takenAt?: string }).takenAt

    let kind: 'photo' | 'video' | undefined
    let fileResult: { status: number; data: FileRecord }
    try {
      const kindFromClient = (req.body as { kind?: string }).kind
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

      const form = new FormData()
      form.append('file', createReadStream(file.path), {
        filename: file.originalname,
        contentType: file.mimetype,
      })
      form.append('userId', userId)

      fileResult = await this.proxy.forward<FileRecord>(SERVICE_URLS['file-storage-service'], {
        method: 'POST',
        path: 'v1/files',
        body: form,
        headers: {
          'x-request-id': requestId,
        },
        timeout: 3_600_000,
      })
    } finally {
      await unlink(file.path).catch(() => undefined)
    }

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
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          originalName: record.originalName,
        },
        headers: {
          'x-request-id': requestId,
        },
        timeout: 5_000,
      })
      this.bullmq.enqueueThumbnails(assetResult.data.id, record.id, userId)
      void this.bullmq.enqueue(
        'process-metadata',
        'process-metadata',
        {
          assetId: assetResult.data.id,
          fileId: record.id,
          userId,
          kind,
        },
        { jobId: assetResult.data.id, attempts: 3, backoff: { type: 'exponential' } },
      )
      if (kind === 'video') {
        this.bullmq.enqueueVideo(assetResult.data.id, record.id, userId)
      }
      if (kind === 'photo') {
        void this.bullmq.enqueue(
          'process-faces',
          'process-faces',
          {
            assetId: assetResult.data.id,
            fileId: record.id,
            userId,
          },
          { jobId: `face:${assetResult.data.id}:detect` },
        )
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

  @Post('derivatives')
  @UseInterceptors(
    FileInterceptor('file', { storage: tmpStorage, limits: { fileSize: 4 * 1024 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Register a derivative file (e.g. transcoded video) for an existing asset',
  })
  @ApiResponse({ status: 201, description: 'Derivative file record created' })
  @ApiResponse({ status: 400, description: 'No file or invalid request' })
  @ApiResponse({ status: 502, description: 'Upstream server error' })
  async uploadDerivative(
    @Req() req: Request,
    @UploadedFile() file: { path: string; originalname: string; mimetype: string },
  ) {
    const userId = (req.user as { id: string }).id
    const requestId = (req.headers['x-request-id'] as string) ?? ''
    const assetId = (req.body as { assetId?: string }).assetId

    let result: { status: number; data: FileRecord }
    try {
      const form = new FormData()
      form.append('file', createReadStream(file.path), {
        filename: file.originalname,
        contentType: file.mimetype,
      })
      form.append('userId', userId)
      form.append('assetId', assetId ?? '')

      result = await this.proxy.forward<FileRecord>(SERVICE_URLS['file-storage-service'], {
        method: 'POST',
        path: 'v1/files/derivatives',
        body: form,
        headers: {
          'x-request-id': requestId,
        },
        timeout: 3_600_000,
      })
    } finally {
      await unlink(file.path).catch(() => undefined)
    }

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
  @ApiResponse({ status: 502, description: 'Upstream server error' })
  async download(@Param('fileId') fileId: string, @Req() req: Request, @Res() res: Response) {
    const url = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/download`
    const upstream = await firstValueFrom(
      this.http.get(url, {
        responseType: 'stream',
        params: { userId: (req.user as { id: string }).id },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 300_000,
        validateStatus: () => true,
      }),
    )
    const stream = upstream.data as Readable
    if (upstream.status >= 500) {
      stream.destroy()
      throw new BadGatewayException({
        statusCode: 502,
        upstream: SERVICE_URLS['file-storage-service'],
        message: 'Upstream server error',
      })
    }
    if (upstream.status >= 400) {
      stream.destroy()
      res.status(upstream.status).json({
        statusCode: upstream.status,
        message: upstream.statusText || 'Request failed',
      })
      return
    }
    res.set({
      'Content-Type': upstream.headers['content-type'] as string,
      ...(upstream.headers['content-length']
        ? { 'Content-Length': upstream.headers['content-length'] as string }
        : {}),
      ...(upstream.headers['content-disposition']
        ? { 'Content-Disposition': upstream.headers['content-disposition'] as string }
        : {}),
    })
    stream.on('error', (err) => {
      res.destroy(err)
    })
    res.on('close', () => {
      stream.destroy()
    })
    stream.pipe(res)
  }

  @Public()
  @Get(':fileId/stream')
  @ApiOperation({ summary: 'Stream file for video playback (public, capability URL)' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async stream(@Param('fileId') fileId: string, @Req() req: Request, @Res() res: Response) {
    const url = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/stream`
    const upstream = await firstValueFrom(
      this.http.get(url, {
        responseType: 'stream',
        params: { userId: (req.query.userId as string) ?? '' },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
          ...(req.headers.range ? { range: req.headers.range } : {}),
        },
        timeout: 30_000,
        validateStatus: () => true,
      }),
    )
    if (upstream.status >= 400) {
      res.status(upstream.status).json({ statusCode: upstream.status, message: 'File not found' })
      return
    }
    res.set({
      'Content-Type': upstream.headers['content-type'] as string,
      ...(upstream.headers['content-range']
        ? { 'content-range': upstream.headers['content-range'] as string }
        : {}),
      ...(upstream.headers['accept-ranges']
        ? { 'accept-ranges': upstream.headers['accept-ranges'] as string }
        : {}),
    })
    res.status(upstream.status)
    ;(upstream.data as NodeJS.ReadableStream).pipe(res)
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
