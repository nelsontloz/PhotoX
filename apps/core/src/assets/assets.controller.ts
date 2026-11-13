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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { AssetsService } from './assets.service';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { ListAssetsQueryDto } from './dto/list-assets-query.dto';
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
