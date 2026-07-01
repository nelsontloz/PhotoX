import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { ProxyService } from '../proxy.service'
import { CreateAssetDto } from './dto/create-asset.dto'
import { UpdateAssetDto } from './dto/update-asset.dto'
import { SERVICE_URLS } from '@photox/shared-config'
import { BullMqService } from '../../queue/bullmq.service'

@ApiTags('assets')
@Controller('api/v1/assets')
export class AssetsProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly bullmq: BullMqService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an asset from an uploaded file' })
  @ApiResponse({ status: 201, description: 'Asset created' })
  async create(@Body() dto: CreateAssetDto, @Req() req: Request) {
    const result = await this.proxy.forward<{ id: string; fileId: string }>(
      SERVICE_URLS['media-service'],
      {
        method: 'POST',
        path: 'v1/assets',
        body: { ...dto, userId: (req.user as { id: string }).id },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 30_000,
      },
    )
    const userId = (req.user as { id: string }).id
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      void this.bullmq.enqueue(
        'process-thumbnail',
        'process-thumbnail',
        {
          assetId: result.data.id,
          fileId: result.data.fileId,
          userId,
          size,
        },
        { jobId: `thumb:${result.data.id}:${size}` },
      )
    }
    if (dto.kind === 'video') {
      void this.bullmq.enqueue(
        'process-video',
        'process-video',
        {
          assetId: result.data.id,
          fileId: result.data.fileId,
          userId,
        },
        { jobId: `video:${result.data.id}:v`, attempts: 3, backoff: { type: 'exponential' } },
      )
    }
    return result.data
  }

  @Get()
  @ApiOperation({ summary: 'List assets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  async list(@Query() q: Record<string, string | undefined>, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: 'v1/assets',
      query: { ...q, userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single asset' })
  @ApiResponse({ status: 200, description: 'Asset found' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getOne(@Param('id') id: string, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/assets/${id}`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update asset metadata' })
  @ApiResponse({ status: 200, description: 'Asset updated' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateAssetDto, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'PATCH',
      path: `v1/assets/${id}`,
      body: { ...dto, userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Post(':id/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete (trash) an asset' })
  @ApiResponse({ status: 204, description: 'Asset trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async trash(@Param('id') id: string, @Req() req: Request) {
    await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'POST',
      path: `v1/assets/${id}/trash`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore a trashed asset' })
  @ApiResponse({ status: 204, description: 'Asset restored' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async restore(@Param('id') id: string, @Req() req: Request) {
    await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'POST',
      path: `v1/assets/${id}/restore`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
  }

  @Post(':id/reprocess-thumbnails')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-enqueue thumbnail generation for all sizes' })
  @ApiResponse({ status: 200, description: 'Thumbnail jobs enqueued' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async reprocessThumbnails(@Param('id') id: string, @Req() req: Request) {
    const userId = (req.user as { id: string }).id
    const result = await this.proxy.forward<{ id: string; fileId: string }>(
      SERVICE_URLS['media-service'],
      {
        method: 'GET',
        path: `v1/assets/${id}`,
        query: { userId },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 30_000,
      },
    )
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      void this.bullmq.enqueue(
        'process-thumbnail',
        'process-thumbnail',
        { assetId: result.data.id, fileId: result.data.fileId, userId, size },
        { jobId: `reprocess:${result.data.id}:${size}` },
      )
    }
    return { enqueued: true }
  }

  @Post(':id/reprocess-video')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-enqueue video transcoding' })
  @ApiResponse({ status: 200, description: 'Video job enqueued' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async reprocessVideo(@Param('id') id: string, @Req() req: Request) {
    const userId = (req.user as { id: string }).id
    const result = await this.proxy.forward<{ id: string; fileId: string }>(
      SERVICE_URLS['media-service'],
      {
        method: 'GET',
        path: `v1/assets/${id}`,
        query: { userId },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 30_000,
      },
    )
    void this.bullmq.enqueue(
      'process-video',
      'process-video',
      { assetId: result.data.id, fileId: result.data.fileId, userId },
      { jobId: `video:reprocess:${result.data.id}`, attempts: 3, backoff: { type: 'exponential' } },
    )
    return { enqueued: true }
  }

  @Get(':id/thumbnails')
  @ApiOperation({ summary: 'List thumbnails for an asset' })
  @ApiResponse({ status: 200, description: 'Thumbnail list' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async listThumbnails(@Param('id') id: string, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/assets/${id}/thumbnails`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Get(':id/thumbnails/:size')
  @ApiOperation({ summary: 'Get a specific thumbnail size' })
  @ApiResponse({ status: 200, description: 'Thumbnail details' })
  @ApiResponse({ status: 404, description: 'Thumbnail not found' })
  async getThumbnail(@Param('id') id: string, @Param('size') size: string, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/assets/${id}/thumbnails/${size}`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Post(':id/faces')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register detected faces for an asset' })
  @ApiResponse({ status: 201, description: 'Faces registered' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async registerFaces(
    @Param('id') id: string,
    @Body() body: { userId: string; faces: unknown[] },
    @Req() req: Request,
  ) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'POST',
      path: `v1/assets/${id}/faces`,
      body,
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }
}
