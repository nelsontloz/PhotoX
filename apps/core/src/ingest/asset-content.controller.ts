import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { AssetsService } from '../assets/assets.service';
import { serveFileBytes } from '../common/streaming.util';
import { UserFilesService } from './user-files.service';
import { AssetContentQueryDto } from './dto/asset-content-query.dto';

/**
 * Asset-scoped byte routes. The asset read is what authorizes the bytes, so the URL is derivable
 * from it (`/assets/:id/content`) and no client has to decide between the original and a
 * derivative — that choice is `AssetsService.contentTarget`.
 *
 * Lives in the files module only because it needs `UserFilesService` to stream; the inverse
 * import would be circular.
 */
@ApiTags('assets')
@ApiBearerAuth()
@Controller('api/v1/assets')
export class AssetContentController {
  constructor(
    private readonly assets: AssetsService,
    private readonly files: UserFilesService,
  ) {}

  @Get(':id/content')
  @ApiOperation({
    summary: 'Stream an asset’s displayable bytes (transcode when available, else the original)',
  })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 206, description: 'Partial content' })
  @ApiResponse({ status: 404, description: 'Asset not found, trashed, or has no bytes' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async content(
    @Param('id') id: string,
    @Query() q: AssetContentQueryDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    const fileId = await this.assets.contentTarget(userId, id, q.variant ?? 'display');
    await serveFileBytes(req, res, this.files, userId, fileId);
  }

  @Get(':id/content/download')
  @ApiOperation({ summary: 'Download an asset’s original bytes' })
  @ApiResponse({
    status: 200,
    description: 'Original file stream (Content-Disposition attachment)',
  })
  @ApiResponse({ status: 404, description: 'Asset not found, trashed, or has no bytes' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async download(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    const fileId = await this.assets.contentTarget(userId, id, 'original');
    await serveFileBytes(req, res, this.files, userId, fileId, { attachment: true });
  }
}
