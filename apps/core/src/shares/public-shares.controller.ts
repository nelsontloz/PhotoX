import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { ApiExtraModels, ApiTags, ApiOperation, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SharesService } from './shares.service';
import { UserFilesService } from '../ingest/user-files.service';
import { ListPublicAlbumAssetsQueryDto } from './dto/list-shares-query.dto';
import { serveFileBytes } from '../common/streaming.util';
import {
  PublicAlbumAssetsResponseModel,
  PublicAlbumShareResponseModel,
  PublicAssetShareResponseModel,
} from '../swagger/response-models';

@ApiTags('shares')
@ApiExtraModels(PublicAssetShareResponseModel, PublicAlbumShareResponseModel)
@Controller('api/share')
export class PublicSharesController {
  constructor(
    private readonly shares: SharesService,
    private readonly files: UserFilesService,
  ) {}

  @Get(':token')
  @ApiOperation({ summary: 'Get a shared asset or album by public token' })
  @ApiResponse({
    status: 200,
    description: 'Shared asset or album info',
    // the payload matches the share's kind: one asset projection or one album projection
    schema: {
      oneOf: [
        { $ref: getSchemaPath(PublicAssetShareResponseModel) },
        { $ref: getSchemaPath(PublicAlbumShareResponseModel) },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async getByToken(@Param('token') token: string) {
    return this.shares.getByToken(token);
  }

  @Get(':token/assets')
  @ApiOperation({ summary: 'List the non-trashed members of a shared album (keyset page)' })
  @ApiResponse({
    status: 200,
    description: 'Album asset list',
    type: PublicAlbumAssetsResponseModel,
  })
  @ApiResponse({ status: 404, description: 'Share not found or not an album share' })
  async listAlbumAssets(@Param('token') token: string, @Query() q: ListPublicAlbumAssetsQueryDto) {
    return this.shares.listAlbumAssetsByToken(token, q);
  }

  @Get(':token/content')
  @ApiOperation({ summary: 'Stream a single-asset share’s displayable bytes' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 206, description: 'Partial content' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async contentByToken(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    await this.serveAssetByToken(token, req, res);
  }

  @Get(':token/assets/:assetId/content')
  @ApiOperation({ summary: 'Stream an album share member (optional ?size=sm thumbnail)' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 206, description: 'Partial content' })
  @ApiResponse({ status: 404, description: 'Share or asset not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async contentForAlbumAsset(
    @Param('token') token: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Query('size') size: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.serveAlbumAsset(token, assetId, size, req, res);
  }

  /** File ids never leave the server: resolve the playable target from the token, then stream. */
  private async serveAssetByToken(token: string, req: Request, res: Response): Promise<void> {
    // getAssetStreamTarget 404s unknown/expired/non-asset shares alike
    const { fileId, userId } = await this.shares.getAssetStreamTarget(token);
    await serveFileBytes(req, res, this.files, userId, fileId);
  }

  private async serveAlbumAsset(
    token: string,
    assetId: string,
    size: string | undefined,
    req: Request,
    res: Response,
  ): Promise<void> {
    const { fileId, userId } = await this.shares.getAlbumAssetFileId(token, assetId, size);
    await serveFileBytes(req, res, this.files, userId, fileId);
  }
}
