import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import { ApiExtraModels, ApiTags, ApiOperation, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { setResourceLocation } from '../common/resource-headers';
import { SharesService } from './shares.service';
import { CreateShareDto } from './dto/create-share.dto';
import { ListSharesQueryDto } from './dto/list-shares-query.dto';
import {
  AlbumShareModel,
  AssetShareModel,
  ShareListResponseModel,
} from '../swagger/response-models';

@ApiTags('shares')
@ApiExtraModels(AssetShareModel, AlbumShareModel)
@Controller('api/v1/shares')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a public share link for an asset or an album' })
  @ApiResponse({
    status: 201,
    description: 'Share created',
    // one share row, in the variant matching the request (asset or album)
    schema: {
      oneOf: [{ $ref: getSchemaPath(AssetShareModel) }, { $ref: getSchemaPath(AlbumShareModel) }],
    },
  })
  @ApiResponse({ status: 400, description: 'Provide exactly one of assetId or albumId' })
  @ApiResponse({ status: 404, description: 'Asset or album not found' })
  async create(
    @Body() dto: CreateShareDto,
    @CurrentUserId() userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const share = await this.shares.create(userId, dto);
    setResourceLocation(res, `/api/v1/shares/${share.id}`);
    return share;
  }

  @Get()
  @ApiOperation({ summary: 'List shares created by a user (keyset page)' })
  @ApiResponse({ status: 200, description: 'Share list', type: ShareListResponseModel })
  async list(@CurrentUserId() userId: string, @Query() q: ListSharesQueryDto) {
    return this.shares.list(userId, q);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a share link' })
  @ApiResponse({ status: 204, description: 'Share revoked' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async revoke(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUserId() userId: string) {
    await this.shares.revoke(userId, id);
  }
}
