import { Controller, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { ThumbnailsService } from './thumbnails.service'
import { RegisterThumbnailDto } from './dto/register-thumbnail.dto'
import { ThumbnailResponseDto } from './dto/thumbnail-response.dto'

@ApiTags('internal-asset-thumbnails')
@Controller('v1/internal/assets')
export class InternalThumbnailsController {
  constructor(private readonly thumbs: ThumbnailsService) {}

  @Post(':id/thumbnails')
  @ApiOperation({
    summary: 'Register a thumbnail (idempotent upsert on assetId+size)',
  })
  @ApiResponse({ status: 201, type: ThumbnailResponseDto })
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
}
