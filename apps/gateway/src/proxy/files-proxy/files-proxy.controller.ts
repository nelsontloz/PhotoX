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
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { firstValueFrom } from 'rxjs'
import { ProxyService } from '../proxy.service'
import { SERVICE_URLS } from '@photox/shared-config'
import type { FileListResponse, FileRecord } from '@photox/shared-types'
import { ListFilesQueryDto } from './dto/list-files-query.dto'

@ApiTags('files')
@Controller('api/v1/files')
export class FilesProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly http: HttpService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file' })
  @ApiResponse({ status: 201, description: 'File uploaded' })
  @ApiResponse({ status: 400, description: 'No file or invalid request' })
  async upload(@Req() req: Request, @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string }) {
    const form = new FormData()
    form.append(
      'file',
      new Blob([file.buffer], { type: file.mimetype }),
      file.originalname,
    )
    const result = await this.proxy.forward<FileRecord>(SERVICE_URLS['file-storage-service'], {
      method: 'POST',
      path: 'v1/files',
      body: form,
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': (req.user as { id: string }).id,
      },
      timeout: 180_000,
    })
    return result.data
  }

  @Get()
  @ApiOperation({ summary: 'List files with filters' })
  @ApiResponse({ status: 200, description: 'Paginated file list' })
  async list(@Query() q: ListFilesQueryDto, @Req() req: Request): Promise<FileListResponse> {
    const result = await this.proxy.forward<FileListResponse>(
      SERVICE_URLS['file-storage-service'],
      {
        method: 'GET',
        path: 'v1/files',
        query: q as unknown as Record<string, string>,
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
          'x-user-id': (req.user as { id: string }).id,
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
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': (req.user as { id: string }).id,
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
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
          'x-user-id': (req.user as { id: string }).id,
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
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': (req.user as { id: string }).id,
      },
      timeout: 30_000,
    })
  }
}
