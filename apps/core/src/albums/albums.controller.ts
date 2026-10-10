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
import { AlbumsService } from './albums.service'
import { CreateAlbumDto } from './dto/create-album.dto'
import { UpdateAlbumDto } from './dto/update-album.dto'
import { PaginationQueryDto } from '../common/pagination-query.dto'
import { AddAssetsBodyDto } from './dto/add-assets.dto'

@ApiTags('albums')
@Controller('api/v1/albums')
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new album' })
  @ApiResponse({ status: 201, description: 'Album created' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async create(@Body() dto: CreateAlbumDto, @Req() req: Request) {
    return this.albums.create((req.user as { id: string }).id, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List albums' })
  @ApiResponse({ status: 200, description: 'Paginated album list' })
  async list(@Query() q: PaginationQueryDto, @Req() req: Request) {
    return this.albums.list((req.user as { id: string }).id, q)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single album' })
  @ApiResponse({ status: 200, description: 'Album found' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async getOne(@Param('id') id: string, @Req() req: Request) {
    return this.albums.getOne((req.user as { id: string }).id, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update album name or description' })
  @ApiResponse({ status: 200, description: 'Album updated' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateAlbumDto, @Req() req: Request) {
    return this.albums.update((req.user as { id: string }).id, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an album' })
  @ApiResponse({ status: 204, description: 'Album deleted' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async delete(@Param('id') id: string, @Req() req: Request) {
    await this.albums.delete((req.user as { id: string }).id, id)
  }

  @Post(':id/assets')
  @ApiOperation({ summary: 'Add assets to an album' })
  @ApiResponse({ status: 201, description: 'Assets added, returns refreshed album' })
  @ApiResponse({ status: 404, description: 'Album or asset not found' })
  async addAssets(@Param('id') id: string, @Body() dto: AddAssetsBodyDto, @Req() req: Request) {
    await this.albums.addAssets((req.user as { id: string }).id, id, dto.assetIds)
    return { added: dto.assetIds.length }
  }

  @Delete(':id/assets/:assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an asset from an album' })
  @ApiResponse({ status: 204, description: 'Asset removed' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async removeAsset(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @Req() req: Request,
  ) {
    await this.albums.removeAsset((req.user as { id: string }).id, id, assetId)
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'List assets in an album' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async listAssets(@Param('id') id: string, @Req() req: Request, @Query() q: PaginationQueryDto) {
    const userId = (req.user as { id: string }).id
    return this.albums.listAssets(userId, id, { limit: q.limit, offset: q.offset })
  }
}
