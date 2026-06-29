import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { CreateAlbumDto } from './dto/create-album.dto'
import { UpdateAlbumDto } from './dto/update-album.dto'
import { AddAssetsToAlbumDto } from './dto/add-assets.dto'
import { SERVICE_URLS } from '@photox/shared-config'

@ApiTags('albums')
@Controller('api/v1/albums')
export class AlbumsProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an album' })
  @ApiResponse({ status: 201, description: 'Album created' })
  async create(@Body() dto: CreateAlbumDto, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'POST',
      path: 'v1/albums',
      body: { ...dto, userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Get()
  @ApiOperation({ summary: 'List albums' })
  @ApiResponse({ status: 200, description: 'Album list' })
  async list(@Query() q: Record<string, string | undefined>, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: 'v1/albums',
      query: { ...q, userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single album' })
  @ApiResponse({ status: 200, description: 'Album found' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async getOne(@Param('id') id: string, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/albums/${id}`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an album' })
  @ApiResponse({ status: 200, description: 'Album updated' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateAlbumDto, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'PATCH',
      path: `v1/albums/${id}`,
      body: { ...dto, userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an album' })
  @ApiResponse({ status: 204, description: 'Album deleted' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async delete(@Param('id') id: string, @Req() req: Request) {
    await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'DELETE',
      path: `v1/albums/${id}`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
  }

  @Post(':id/assets')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add assets to an album' })
  @ApiResponse({ status: 201, description: 'Assets added' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async addAssets(@Param('id') id: string, @Body() dto: AddAssetsToAlbumDto, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'POST',
      path: `v1/albums/${id}/assets`,
      body: { ...dto, userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Delete(':id/assets/:assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an asset from an album' })
  @ApiResponse({ status: 204, description: 'Asset removed' })
  @ApiResponse({ status: 404, description: 'Album or asset not found' })
  async removeAsset(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @Req() req: Request,
  ) {
    await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'DELETE',
      path: `v1/albums/${id}/assets/${assetId}`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'List assets in an album' })
  @ApiResponse({ status: 200, description: 'Album asset list' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async listAssets(
    @Param('id') id: string,
    @Query() q: Record<string, string | undefined>,
    @Req() req: Request,
  ) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/albums/${id}/assets`,
      query: { ...q, userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }
}
