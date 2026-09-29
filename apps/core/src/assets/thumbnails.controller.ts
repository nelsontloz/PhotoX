import { Controller, Post, Param, Body, Req, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { ThumbnailsService } from './thumbnails.service'
import { RegisterThumbnailDto } from './dto/register-thumbnail.dto'

@ApiTags('asset-thumbnails')
@Controller('api/v1/assets')
export class ThumbnailsController {
  constructor(private readonly thumbs: ThumbnailsService) {}

  @Post(':id/thumbnails')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a thumbnail (idempotent upsert on assetId+size)',
  })
  @ApiResponse({ status: 201, description: 'Thumbnail registered' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async register(@Param('id') id: string, @Body() dto: RegisterThumbnailDto, @Req() req: Request) {
    return this.thumbs.register((req.user as { id: string }).id, id, dto)
  }
}
