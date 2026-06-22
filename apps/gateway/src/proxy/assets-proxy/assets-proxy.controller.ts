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
import { ListAssetsQueryDto } from './dto/list-assets-query.dto'
import { SERVICE_URLS } from '@photox/shared-config'

@ApiTags('assets')
@Controller('api/v1/assets')
export class AssetsProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an asset from an uploaded file' })
  @ApiResponse({ status: 201, description: 'Asset created' })
  async create(@Body() dto: CreateAssetDto, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'POST',
      path: 'v1/assets',
      body: dto,
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': (req.user as { id: string }).id,
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Get()
  @ApiOperation({ summary: 'List assets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  async list(@Query() q: ListAssetsQueryDto, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: 'v1/assets',
      query: q as unknown as Record<string, string>,
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': (req.user as { id: string }).id,
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
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': (req.user as { id: string }).id,
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
      body: dto,
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': (req.user as { id: string }).id,
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
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': (req.user as { id: string }).id,
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
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': (req.user as { id: string }).id,
      },
      timeout: 30_000,
    })
  }
}
