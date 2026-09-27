import {
  Controller,
  Get,
  Post,
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

  @Delete(':id/thumbnails/:size')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a thumbnail registration. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Thumbnail unregistered' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async unregister(@Param('id') id: string, @Param('size') size: string, @Req() req: Request) {
    await this.thumbs.unregister((req.user as { id: string }).id, id, size)
  }

  @Get(':id/thumbnails')
  @ApiOperation({ summary: 'List all thumbnails for an asset' })
  @ApiResponse({ status: 200, description: 'Thumbnail list' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async list(@Param('id') id: string, @Req() req: Request, @Query('userId') queryUserId?: string) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    return this.thumbs.listForAsset(userId, id)
  }

  @Get(':id/thumbnails/:size')
  @ApiOperation({ summary: 'Get a specific thumbnail metadata by size' })
  @ApiResponse({ status: 200, description: 'Thumbnail details' })
  @ApiResponse({ status: 404, description: 'Asset or thumbnail not found' })
  async getOne(
    @Param('id') id: string,
    @Param('size') size: string,
    @Req() req: Request,
    @Query('userId') queryUserId?: string,
  ) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    return this.thumbs.getForAsset(userId, id, size)
  }
}
