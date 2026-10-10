import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  ParseBoolPipe,
  ParseUUIDPipe,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { CurrentUserId } from '../auth/jwt-auth.guard'
import { AssetsService } from './assets.service'
import { UpdateAssetDto } from './dto/update-asset.dto'
import { ListAssetsQueryDto } from './dto/list-assets-query.dto'
import { UpdateMetadataDto } from './dto/update-metadata.dto'
import { TrashAssetsDto } from './dto/trash-assets.dto'
import { RegisterThumbnailDto } from './dto/register-thumbnail.dto'

function layoutEtag(fingerprint: { count: number; maxUpdatedAtMs: number }): string {
  return `"layout-${fingerprint.count}-${fingerprint.maxUpdatedAtMs}"`
}

@ApiTags('assets')
@Controller('api/v1/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @ApiOperation({ summary: 'List assets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  async list(@Query() q: ListAssetsQueryDto, @CurrentUserId() userId: string) {
    return this.assets.list(userId, q)
  }

  @Get('layout')
  @ApiOperation({ summary: 'Compact timeline layout: timestamps and aspect dimensions only' })
  @ApiResponse({ status: 200, description: 'Asset layout list' })
  @ApiResponse({ status: 304, description: 'ETag match — layout unchanged' })
  async layout(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUserId() userId: string,
    @Query('personId', new ParseUUIDPipe({ optional: true })) personId?: string,
    @Query('favorite', new ParseBoolPipe({ optional: true })) favorite?: boolean,
    @Query('albumId', new ParseUUIDPipe({ optional: true })) albumId?: string,
  ) {
    // ponytail: the ETag fingerprint covers asset mutations only — clustering moves faces between
    // persons and album membership changes without touching assets, so filtered layouts can change
    // behind a matching ETag. Filtered requests skip revalidation and always get the body (cheap,
    // scoped payloads).
    if (!personId && !favorite && !albumId) {
      const fingerprint = await this.assets.layoutFingerprint(userId)
      // ETag must be on the response before `req.fresh` compares it against If-None-Match.
      res.setHeader('ETag', layoutEtag(fingerprint))
      if (req.fresh) {
        res.status(HttpStatus.NOT_MODIFIED).end()
        return
      }
    }
    const body = await this.assets.layout(userId, personId, favorite, albumId)
    // private, no-cache: browser stores the body but must revalidate (conditional GET → 304)
    // every load; Vary: Authorization keeps per-user bodies out of each other's cache slots.
    res.setHeader('Cache-Control', 'private, no-cache')
    res.setHeader('Vary', 'Authorization')
    res.json(body)
  }

  @Patch(':id/metadata')
  @ApiOperation({ summary: 'Update extracted metadata (called by metadata process)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async updateMetadata(
    @Param('id') id: string,
    @Body() dto: UpdateMetadataDto,
    @CurrentUserId() userId: string,
  ) {
    return this.assets.updateMetadata(id, userId, dto)
  }

  @Get('trashed')
  @ApiOperation({ summary: 'List trashed assets' })
  @ApiResponse({ status: 200, description: 'Paginated trashed asset list' })
  async listTrashed(@Query() q: ListAssetsQueryDto, @CurrentUserId() userId: string) {
    return this.assets.list(userId, { ...q, isTrashed: true })
  }

  @Delete('trashed')
  @ApiOperation({ summary: 'Permanently delete all trashed assets. Returns file IDs for cleanup.' })
  @ApiResponse({ status: 200, description: 'Trash emptied' })
  async emptyTrash(@CurrentUserId() userId: string) {
    return this.assets.emptyTrash(userId)
  }

  @Delete('trashed/:id')
  @ApiOperation({ summary: 'Permanently delete a trashed asset. Returns file IDs for cleanup.' })
  @ApiResponse({ status: 200, description: 'Asset deleted' })
  @ApiResponse({ status: 400, description: 'Asset is not trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async deleteTrashed(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.delete(userId, id)
  }

  @Post('trashed/:id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore a trashed asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset restored' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async restore(@Param('id') id: string, @CurrentUserId() userId: string) {
    await this.assets.restore(userId, id)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single asset' })
  @ApiResponse({ status: 200, description: 'Asset found' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getOne(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.getOne(userId, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user-editable asset metadata' })
  @ApiResponse({ status: 200, description: 'Asset updated' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUserId() userId: string,
  ) {
    return this.assets.update(userId, id, dto)
  }

  @Post(':id/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete (trash) an asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async trash(@Param('id') id: string, @CurrentUserId() userId: string) {
    await this.assets.trash(userId, id)
  }

  @Post('bulk-trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bulk soft-delete (trash) assets. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Assets trashed' })
  async bulkTrash(@Body() dto: TrashAssetsDto, @CurrentUserId() userId: string) {
    await this.assets.bulkTrash(userId, dto.assetIds)
  }

  @Post(':id/reprocess-thumbnails')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-process thumbnails for an asset' })
  @ApiResponse({ status: 202, description: 'Thumbnail jobs enqueued' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async reprocessThumbnails(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.reprocessThumbnails(userId, id)
  }

  @Post(':id/reprocess-video')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-process video transcoding for an asset' })
  @ApiResponse({ status: 202, description: 'Video job enqueued' })
  @ApiResponse({ status: 400, description: 'Not a video asset' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async reprocessVideo(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.reprocessVideo(userId, id)
  }

  @Post(':id/thumbnails')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a thumbnail (idempotent upsert on assetId+size)',
  })
  @ApiResponse({ status: 201, description: 'Thumbnail registered' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async registerThumbnail(
    @Param('id') id: string,
    @Body() dto: RegisterThumbnailDto,
    @CurrentUserId() userId: string,
  ) {
    return this.assets.registerThumbnail(userId, id, dto)
  }
}
