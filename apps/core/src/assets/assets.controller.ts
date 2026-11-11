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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { AssetsService } from './assets.service';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { ListAssetsQueryDto } from './dto/list-assets-query.dto';
import { LayoutQueryDto } from './dto/layout-query.dto';
import { TrashAssetsDto } from './dto/trash-assets.dto';

@ApiTags('assets')
@ApiBearerAuth()
@Controller('api/v1/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @ApiOperation({ summary: 'List assets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  async list(@Query() q: ListAssetsQueryDto, @CurrentUserId() userId: string) {
    return this.assets.list(userId, q);
  }

  @Get('layout')
  @ApiOperation({ summary: 'Compact timeline layout: timestamps and aspect dimensions only' })
  @ApiResponse({ status: 200, description: 'Asset layout list or one month window page' })
  @ApiResponse({ status: 304, description: 'ETag match — layout unchanged' })
  async layout(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUserId() userId: string,
    @Query() q: LayoutQueryDto,
  ) {
    // Both or neither: a half-open range would silently page a window nobody asked for.
    if ((q.from === undefined) !== (q.to === undefined)) {
      throw new BadRequestException('from and to must be supplied together');
    }

    if (q.from !== undefined && q.to !== undefined) {
      const body = await this.assets.layout(userId, q.personId, q.favorite, q.albumId, {
        from: new Date(q.from),
        to: new Date(q.to),
        offset: q.offset ?? 0,
        limit: q.limit ?? 2000,
      });
      res.setHeader('Cache-Control', 'private, no-cache');
      res.vary('Authorization');
      this.sendJson(res, body);
      return;
    }

    // `offset: 0` is falsy but still a paging request: without a window it must not fall through
    // to the whole-library body, which is exactly what this endpoint is meant to stop serving.
    if (q.offset !== undefined || q.limit !== undefined) {
      throw new BadRequestException('offset/limit require from and to');
    }

    // ponytail: the ETag fingerprint covers asset mutations and hidden-album membership only —
    // clustering moves faces between persons and filtered album views change without touching
    // assets, so filtered layouts can change behind a matching ETag. Filtered requests skip
    // revalidation and always get the body (cheap, scoped payloads).
    if (!q.personId && !q.favorite && !q.albumId) {
      const fingerprint = await this.assets.layoutFingerprint(userId);
      // ETag must be on the response before `req.fresh` compares it against If-None-Match.
      // It also covers hidden-album membership: album changes never bump assets.updatedAt.
      res.setHeader(
        'ETag',
        `"layout-${fingerprint.count}-${fingerprint.maxUpdatedAtMs}-${fingerprint.hiddenCount}-${fingerprint.hiddenMaxTouchedMs}"`,
      );
      if (req.fresh) {
        res.status(HttpStatus.NOT_MODIFIED).end();
        return;
      }
    }
    const body = await this.assets.layout(userId, q.personId, q.favorite, q.albumId);
    // private, no-cache: browser stores the body but must revalidate (conditional GET → 304)
    // every load; Vary: Authorization keeps per-user bodies out of each other's cache slots.
    res.setHeader('Cache-Control', 'private, no-cache');
    res.vary('Authorization');
    res.json(body);
  }

  @Get('layout/months')
  @ApiOperation({ summary: 'Timeline layout month index: local month windows with versions' })
  @ApiResponse({ status: 200, description: 'Month windows with per-window versions' })
  @ApiResponse({ status: 400, description: 'Invalid timezone' })
  async layoutMonths(
    @Res() res: Response,
    @CurrentUserId() userId: string,
    @Query() q: LayoutQueryDto,
  ) {
    const body = await this.assets.layoutMonths(userId, q.personId, q.favorite, q.albumId, q.tz);
    // no-store: the browser never conditionally GETs the index, it only refetches after a change
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Authorization');
    this.sendJson(res, body);
  }

  /**
   * Express appends a weak ETag to every `res.json` body, then answers a matching conditional GET
   * with an empty 304. Both new layout responses must always carry their body (the client compares
   * the returned version), so they are written directly instead.
   */
  private sendJson(res: Response, body: unknown): void {
    const payload = JSON.stringify(body);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(payload));
    res.end(payload);
  }

  @Get('trashed')
  @ApiOperation({ summary: 'List trashed assets' })
  @ApiResponse({ status: 200, description: 'Paginated trashed asset list' })
  async listTrashed(@Query() q: ListAssetsQueryDto, @CurrentUserId() userId: string) {
    return this.assets.list(userId, { ...q, isTrashed: true });
  }

  @Delete('trashed')
  @ApiOperation({ summary: 'Permanently delete all trashed assets' })
  @ApiResponse({ status: 200, description: 'Trash emptied' })
  async emptyTrash(@CurrentUserId() userId: string) {
    await this.assets.emptyTrash(userId);
  }

  @Delete('trashed/:id')
  @ApiOperation({ summary: 'Permanently delete a trashed asset' })
  @ApiResponse({ status: 200, description: 'Asset deleted' })
  @ApiResponse({ status: 400, description: 'Asset is not trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async deleteTrashed(@Param('id') id: string, @CurrentUserId() userId: string) {
    await this.assets.delete(userId, id);
  }

  @Post('trashed/:id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore a trashed asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset restored' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async restore(@Param('id') id: string, @CurrentUserId() userId: string) {
    await this.assets.restore(userId, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single asset' })
  @ApiResponse({ status: 200, description: 'Asset found' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getOne(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.getOne(userId, id);
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
    return this.assets.update(userId, id, dto);
  }

  @Post(':id/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete (trash) an asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async trash(@Param('id') id: string, @CurrentUserId() userId: string) {
    await this.assets.trash(userId, id);
  }

  @Post('bulk-trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bulk soft-delete (trash) assets. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Assets trashed' })
  async bulkTrash(@Body() dto: TrashAssetsDto, @CurrentUserId() userId: string) {
    await this.assets.bulkTrash(userId, dto.assetIds);
  }

  @Post(':id/reprocess-thumbnails')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-process thumbnails for an asset' })
  @ApiResponse({ status: 202, description: 'Thumbnail jobs enqueued' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async reprocessThumbnails(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.reprocessThumbnails(userId, id);
  }

  @Post(':id/reprocess-video')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-process video transcoding for an asset' })
  @ApiResponse({ status: 202, description: 'Video job enqueued' })
  @ApiResponse({ status: 400, description: 'Not a video asset' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async reprocessVideo(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.reprocessVideo(userId, id);
  }
}
