import {
  Controller,
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
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { AssetsService } from './assets.service'
import { UpdateAssetDto } from './dto/update-asset.dto'
import { ListAssetsQueryDto } from './dto/list-assets-query.dto'
import { UpdateMetadataDto } from './dto/update-metadata.dto'
import { TrashAssetsDto } from './dto/trash-assets.dto'

/** Weak-safe ETag matching: handles W/ prefixes, comma lists, and `*`. */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false
  return ifNoneMatch
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === '*' || candidate === etag)
}

export function layoutEtag(fingerprint: { count: number; maxUpdatedAtMs: number }): string {
  return `"layout-${fingerprint.count}-${fingerprint.maxUpdatedAtMs}"`
}

@ApiTags('assets')
@Controller('api/v1/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @ApiOperation({ summary: 'List assets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  async list(@Query() q: ListAssetsQueryDto, @Req() req: Request) {
    return this.assets.list((req.user as { id: string }).id, q)
  }

  @Get('layout')
  @ApiOperation({ summary: 'Compact timeline layout: timestamps and aspect dimensions only' })
  @ApiResponse({ status: 200, description: 'Asset layout list' })
  @ApiResponse({ status: 304, description: 'ETag match — layout unchanged' })
  async layout(@Req() req: Request, @Res() res: Response) {
    const userId = (req.user as { id: string }).id
    const fingerprint = await this.assets.layoutFingerprint(userId)
    const etag = layoutEtag(fingerprint)
    if (etagMatches(req.get('If-None-Match'), etag)) {
      res.status(HttpStatus.NOT_MODIFIED).setHeader('ETag', etag).end()
      return
    }
    const body = await this.assets.layout(userId)
    // private, no-cache: browser stores the body but must revalidate (conditional GET → 304)
    // every load; Vary: Authorization keeps per-user bodies out of each other's cache slots.
    res.setHeader('ETag', etag)
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
    @Req() req: Request,
  ) {
    return this.assets.updateMetadata(id, (req.user as { id: string }).id, dto)
  }

  @Get('trashed')
  @ApiOperation({ summary: 'List trashed assets' })
  @ApiResponse({ status: 200, description: 'Paginated trashed asset list' })
  async listTrashed(@Query() q: ListAssetsQueryDto, @Req() req: Request) {
    return this.assets.list((req.user as { id: string }).id, { ...q, isTrashed: true })
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single asset' })
  @ApiResponse({ status: 200, description: 'Asset found' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getOne(@Param('id') id: string, @Req() req: Request) {
    return this.assets.getOne((req.user as { id: string }).id, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user-editable asset metadata' })
  @ApiResponse({ status: 200, description: 'Asset updated' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateAssetDto, @Req() req: Request) {
    return this.assets.update((req.user as { id: string }).id, id, dto)
  }

  @Post(':id/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete (trash) an asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async trash(@Param('id') id: string, @Req() req: Request) {
    await this.assets.trash((req.user as { id: string }).id, id)
  }

  @Post('bulk-trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bulk soft-delete (trash) assets. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Assets trashed' })
  async bulkTrash(@Body() dto: TrashAssetsDto, @Req() req: Request) {
    await this.assets.bulkTrash((req.user as { id: string }).id, dto.assetIds)
  }

  @Post(':id/reprocess-thumbnails')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-process thumbnails for an asset' })
  @ApiResponse({ status: 202, description: 'Thumbnail jobs enqueued' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async reprocessThumbnails(@Param('id') id: string, @Req() req: Request) {
    return this.assets.reprocessThumbnails((req.user as { id: string }).id, id)
  }

  @Post(':id/reprocess-video')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-process video transcoding for an asset' })
  @ApiResponse({ status: 202, description: 'Video job enqueued' })
  @ApiResponse({ status: 400, description: 'Not a video asset' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async reprocessVideo(@Param('id') id: string, @Req() req: Request) {
    return this.assets.reprocessVideo((req.user as { id: string }).id, id)
  }
}
