import {
  Controller,
  Delete,
  Get,
  Post,
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
import { BullMqService } from '../../queue/bullmq.service'

@ApiTags('trashed')
@Controller('api/v1/assets')
export class TrashProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly bullmq: BullMqService,
  ) {}

  @Get('trashed')
  @ApiOperation({ summary: 'List trashed assets' })
  @ApiResponse({ status: 200, description: 'Paginated trashed asset list' })
  async listTrashed(@Query() q: Record<string, string | undefined>, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: 'v1/assets/trashed',
      query: { ...q, userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Delete('trashed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete all trashed assets' })
  @ApiResponse({ status: 204, description: 'Trash emptied' })
  async emptyTrash(@Req() req: Request) {
    const userId = (req.user as { id: string }).id

    const result = await this.proxy.forward<{ fileId: string; transcodeFileId: string | null }[]>(
      SERVICE_URLS['media-service'],
      {
        method: 'DELETE',
        path: 'v1/assets/trashed',
        query: { userId },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 60_000,
      },
    )

    for (const { fileId, transcodeFileId } of result.data) {
      void this.bullmq.enqueue('cleanup-asset', 'cleanup-asset', {
        fileId,
        transcodeFileId,
      })
    }
  }

  @Delete('trashed/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete a trashed asset' })
  @ApiResponse({ status: 204, description: 'Asset deleted' })
  @ApiResponse({ status: 400, description: 'Asset is not trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async delete(@Param('id') id: string, @Req() req: Request) {
    const result = await this.proxy.forward<{ fileId: string; transcodeFileId: string | null }>(
      SERVICE_URLS['media-service'],
      {
        method: 'DELETE',
        path: `v1/assets/trashed/${id}`,
        query: { userId: (req.user as { id: string }).id },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 30_000,
      },
    )

    void this.bullmq.enqueue('cleanup-asset', 'cleanup-asset', {
      fileId: result.data.fileId,
      transcodeFileId: result.data.transcodeFileId,
    })
  }

  @Post('trashed/:id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore a trashed asset' })
  @ApiResponse({ status: 204, description: 'Asset restored' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async restore(@Param('id') id: string, @Req() req: Request) {
    await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'POST',
      path: `v1/assets/trashed/${id}/restore`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
  }
}
