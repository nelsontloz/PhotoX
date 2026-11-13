import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { AssetsService } from './assets.service';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { ListAssetsQueryDto } from './dto/list-assets-query.dto';
import { PurgeTrashQueryDto } from './dto/purge-trash-query.dto';
import { TrashAssetsDto } from './dto/trash-assets.dto';
import { AssetListResponseModel, AssetModel } from '../swagger/response-models';

@ApiTags('assets')
@ApiBearerAuth()
@Controller('api/v1/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @ApiOperation({ summary: 'List assets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated asset list', type: AssetListResponseModel })
  async list(@Query() q: ListAssetsQueryDto, @CurrentUserId() userId: string) {
    return this.assets.list(userId, q);
  }

  // Trash is a state of the asset, not its own collection: the trash view is
  // `GET api/v1/assets?isTrashed=true`, and these three routes are the state transitions.
  // The collection delete is the exception — it purges everything trashed, so it demands the
  // explicit filter instead of trusting a bare `DELETE /assets` (see PurgeTrashQueryDto).
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete every trashed asset (requires isTrashed=true)' })
  @ApiResponse({ status: 204, description: 'Trash emptied' })
  @ApiResponse({ status: 400, description: 'isTrashed=true is required' })
  async emptyTrash(@CurrentUserId() userId: string, @Query() q: PurgeTrashQueryDto) {
    if (!q.isTrashed) {
      throw new BadRequestException('Emptying the trash requires isTrashed=true');
    }
    await this.assets.emptyTrash(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete a trashed asset' })
  @ApiResponse({ status: 204, description: 'Asset deleted' })
  @ApiResponse({ status: 400, description: 'Asset is not trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async deleteTrashed(@Param('id') id: string, @CurrentUserId() userId: string) {
    await this.assets.delete(userId, id);
  }

  @Delete(':id/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an asset from the trash. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset restored' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async restore(@Param('id') id: string, @CurrentUserId() userId: string) {
    await this.assets.restore(userId, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single asset' })
  @ApiResponse({ status: 200, description: 'Asset found', type: AssetModel })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getOne(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.getOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user-editable asset metadata' })
  @ApiResponse({ status: 200, description: 'Asset updated', type: AssetModel })
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
