import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { ProxyService } from '../proxy.service'
import { SERVICE_URLS } from '@photox/shared-config'
import type { FileListResponse, FileRecord } from '@photox/shared-types'
import { ListFilesQueryDto } from './dto/list-files-query.dto'

@ApiTags('files')
@Controller('api/v1/files')
export class FilesProxyController {
  constructor(private readonly proxy: ProxyService) {}

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
    const result = await this.proxy.forward<FileRecord>(
      SERVICE_URLS['file-storage-service'],
      {
        method: 'GET',
        path: `v1/files/${fileId}`,
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
          'x-user-id': (req.user as { id: string }).id,
        },
        timeout: 30_000,
      },
    )
    return result.data
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
