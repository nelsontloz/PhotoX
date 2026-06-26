import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { ThumbnailsService } from './thumbnails.service'
import { RegisterThumbnailDto } from './dto/register-thumbnail.dto'

@ApiTags('asset-thumbnails')
@Controller('v1/assets')
export class ThumbnailsController {
  constructor(private readonly thumbs: ThumbnailsService) {}

  @Post(':id/thumbnails')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a thumbnail (idempotent upsert on assetId+size)',
  })
  @ApiResponse({ status: 201, description: 'Thumbnail registered' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async register(@Param('id') id: string, @Body() dto: RegisterThumbnailDto) {
    return this.thumbs.register(id, dto)
  }

  @Delete(':id/thumbnails/:size')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a thumbnail registration. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Thumbnail unregistered' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async unregister(@Param('id') id: string, @Param('size') size: string) {
    await this.thumbs.unregister(id, size)
  }

  @Get(':id/thumbnails')
  @ApiOperation({ summary: 'List all thumbnails for an asset' })
  @ApiResponse({ status: 200, description: 'Thumbnail list' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async list(@Param('id') id: string, @Query('userId') userId: string) {
    return this.thumbs.listForAsset(userId, id)
  }

  @Get(':id/thumbnails/:size')
  @ApiOperation({ summary: 'Get a specific thumbnail metadata by size' })
  @ApiResponse({ status: 200, description: 'Thumbnail details' })
  @ApiResponse({ status: 404, description: 'Asset or thumbnail not found' })
  async getOne(
    @Param('id') id: string,
    @Param('size') size: string,
    @Query('userId') userId: string,
  ) {
    return this.thumbs.getForAsset(userId, id, size)
  }
}
