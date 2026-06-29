import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { AlbumsService } from './albums.service'
import { CreateAlbumDto } from './dto/create-album.dto'
import { UpdateAlbumDto } from './dto/update-album.dto'
import { ListAlbumsQueryDto } from './dto/list-albums-query.dto'
import { AddAssetsBodyDto } from './dto/add-assets.dto'

@ApiTags('albums')
@Controller('v1/albums')
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new album' })
  @ApiResponse({ status: 201, description: 'Album created' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async create(@Body() dto: CreateAlbumDto) {
    return this.albums.create(dto.userId, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List albums' })
  @ApiResponse({ status: 200, description: 'Paginated album list' })
  async list(@Query() q: ListAlbumsQueryDto) {
    return this.albums.list(q.userId, q)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single album' })
  @ApiResponse({ status: 200, description: 'Album found' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async getOne(@Param('id') id: string, @Query('userId') userId: string) {
    return this.albums.getOne(userId, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update album name or description' })
  @ApiResponse({ status: 200, description: 'Album updated' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateAlbumDto) {
    return this.albums.update(dto.userId, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an album' })
  @ApiResponse({ status: 204, description: 'Album deleted' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async delete(@Param('id') id: string, @Query('userId') userId: string) {
    await this.albums.delete(userId, id)
  }

  @Post(':id/assets')
  @ApiOperation({ summary: 'Add assets to an album' })
  @ApiResponse({ status: 201, description: 'Assets added, returns refreshed album' })
  @ApiResponse({ status: 404, description: 'Album or asset not found' })
  async addAssets(@Param('id') id: string, @Body() dto: AddAssetsBodyDto) {
    await this.albums.addAssets(dto.userId, id, dto.assetIds)
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
    @Query('userId') userId: string,
  ) {
    await this.albums.removeAsset(userId, id, assetId)
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'List assets in an album' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  @ApiResponse({ status: 404, description: 'Album not found' })
  async listAssets(
    @Param('id') id: string,
    @Query('userId') userId: string,
    @Query() q: Record<string, string | undefined>,
  ) {
    const limit = q.limit ? Number(q.limit) : undefined
    const offset = q.offset ? Number(q.offset) : undefined
    return this.albums.listAssets(userId, id, { limit, offset })
  }
}
