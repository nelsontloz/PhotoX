import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { ThumbnailsService } from './thumbnails.service'
import { UserIdGuard } from './user-id.guard'
import { ThumbnailResponseDto } from './dto/thumbnail-response.dto'

@ApiTags('asset-thumbnails')
@Controller('v1/assets')
@UseGuards(UserIdGuard)
export class ThumbnailsController {
  constructor(private readonly thumbs: ThumbnailsService) {}

  @Get(':id/thumbnails')
  @ApiOperation({ summary: 'List all thumbnails for an asset' })
  @ApiResponse({ status: 200, type: [ThumbnailResponseDto] })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async list(@Req() req: Request, @Param('id') id: string) {
    return this.thumbs.listForAsset(req.userId!, id)
  }

  @Get(':id/thumbnails/:size')
  @ApiOperation({ summary: 'Get a specific thumbnail metadata by size' })
  @ApiResponse({ status: 200, type: ThumbnailResponseDto })
  @ApiResponse({ status: 404, description: 'Asset or thumbnail not found' })
  async getOne(@Req() req: Request, @Param('id') id: string, @Param('size') size: string) {
    return this.thumbs.getForAsset(req.userId!, id, size)
  }
}
