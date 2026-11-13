import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { AssetsService } from './assets.service';
import { TimelineIndexQueryDto, TimelineWindowQueryDto } from './dto/timeline-query.dto';
import { AssetLayoutIndexModel, AssetLayoutPageModel } from '../swagger/response-models';

/**
 * The timeline sync surface: a month index carrying one version per local-calendar window, and a
 * paged window read. The index is the revalidation call — a client refetches only the windows
 * whose version moved, so the `version` contract lives in the operation descriptions below and in
 * `AssetLayoutMonth` (`@photox/shared-types`), which is the normative copy clients read.
 */
@ApiTags('timeline')
@ApiBearerAuth()
@Controller('api/v1/timeline')
export class TimelineController {
  constructor(private readonly assets: AssetsService) {}

  @Get('index')
  @ApiOperation({
    summary: 'Month index: local calendar windows with a per-window version',
    description:
      'The revalidation call: one window per local calendar month in `tz`, each with a `version`. ' +
      'Refetch only the windows whose `version` moved. The token is opaque — compare it for ' +
      'equality only, never parse or order it. It moves on asset add/delete/trash/restore, any ' +
      'asset mutation (dates, title, favourite), a hidden-album toggle or membership change, and ' +
      'album membership changes in `albumId` views. It does NOT move on person clustering (faces ' +
      'carry no updatedAt), so `personId` views are memory-only on the client. Only windows with ' +
      'items are returned: a newly non-empty month appears, an emptied one disappears.',
  })
  @ApiResponse({
    status: 200,
    description: 'Month windows with per-window versions',
    type: AssetLayoutIndexModel,
  })
  @ApiResponse({ status: 400, description: 'Invalid timezone' })
  async index(
    @Res() res: Response,
    @CurrentUserId() userId: string,
    @Query() q: TimelineIndexQueryDto,
  ): Promise<void> {
    const body = await this.assets.layoutMonths(userId, q.personId, q.favorite, q.albumId, q.tz);
    // no-store: the browser never conditionally GETs the index, it only refetches after a change
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Authorization');
    this.sendJson(res, body);
  }

  @Get('window')
  @ApiOperation({
    summary: 'One window page: timestamps and aspect dimensions only',
    description:
      'One page of one window. Pass `from`/`to` back verbatim from the index — they delimit a ' +
      'local calendar month and re-deriving them on the client puts items in the wrong window. ' +
      '`offset` is a row index inside this window, not the collection cursor used by ' +
      '`GET /api/v1/assets`; walk `nextOffset` until it is null. `version` is computed for the ' +
      "whole window: if a page returns a different version than the window's first page, the " +
      'window changed mid-walk — discard the walk and restart that window once. No ETag: the ' +
      'caller must always read the version.',
  })
  @ApiResponse({ status: 200, description: 'One window page', type: AssetLayoutPageModel })
  @ApiResponse({ status: 400, description: 'Missing/invalid from or to, or an invalid filter' })
  async window(
    @Res() res: Response,
    @CurrentUserId() userId: string,
    @Query() q: TimelineWindowQueryDto,
  ): Promise<void> {
    const body = await this.assets.layout(userId, q.personId, q.favorite, q.albumId, {
      from: new Date(q.from),
      to: new Date(q.to),
      offset: q.offset ?? 0,
      limit: q.limit ?? 2000,
    });
    res.setHeader('Cache-Control', 'private, no-cache');
    res.vary('Authorization');
    this.sendJson(res, body);
  }

  /**
   * Express appends a weak ETag to every `res.json` body, then answers a matching conditional GET
   * with an empty 304. Both timeline responses must always carry their body (the client compares
   * the returned version), so they are written directly instead.
   */
  private sendJson(res: Response, body: unknown): void {
    const payload = JSON.stringify(body);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(payload));
    res.end(payload);
  }
}
