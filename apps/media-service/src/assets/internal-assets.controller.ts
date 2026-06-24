import { Controller, Get, Patch, Param, Query, Body } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { AssetsService } from './assets.service'
import { AssetDto } from './dto/asset.dto'
import { AssetListResponseDto } from './dto/asset-list-response.dto'
import { ListUserAssetsQueryDto } from './dto/list-user-assets-query.dto'
import { UpdateMetadataDto } from './dto/update-metadata.dto'

@ApiTags('internal-assets')
@Controller('v1/internal')
export class InternalAssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('users/:userId/assets')
  @ApiOperation({ summary: 'Get all assets for a user (service-to-service)' })
  @ApiResponse({ status: 200, type: AssetListResponseDto })
  async listByUser(@Param('userId') userId: string, @Query() q: ListUserAssetsQueryDto) {
    return this.assets.listByUser(userId, q)
  }

  @Get('assets/by-file/:fileId')
  @ApiOperation({ summary: 'Find asset by fileId (service-to-service)' })
  @ApiResponse({ status: 200, type: AssetDto })
  @ApiResponse({ status: 404, description: 'Asset not found for this fileId' })
  async getByFileId(@Param('fileId') fileId: string) {
    return this.assets.getByFileId(fileId)
  }

  @Patch('assets/:id/metadata')
  @ApiOperation({ summary: 'Update extracted metadata (called by metadata process)' })
  @ApiResponse({ status: 200, type: AssetDto })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async updateMetadata(@Param('id') id: string, @Body() dto: UpdateMetadataDto) {
    return this.assets.updateMetadata(id, dto)
  }
}
