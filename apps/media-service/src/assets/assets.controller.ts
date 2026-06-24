import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { AssetsService } from './assets.service'
import { AssetDto } from './dto/asset.dto'
import { CreateAssetDto } from './dto/create-asset.dto'
import { UpdateAssetDto } from './dto/update-asset.dto'
import { ListAssetsQueryDto } from './dto/list-assets-query.dto'
import { AssetListResponseDto } from './dto/asset-list-response.dto'
import { UpdateMetadataDto } from './dto/update-metadata.dto'

@ApiTags('assets')
@Controller('v1/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an asset from an uploaded fileId' })
  @ApiResponse({ status: 201, description: 'Asset created', type: AssetDto })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async create(@Body() dto: CreateAssetDto) {
    return this.assets.create(dto.userId, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List assets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated asset list', type: AssetListResponseDto })
  async list(@Query() q: ListAssetsQueryDto) {
    return this.assets.list(q.userId, q)
  }

  @Get('by-file/:fileId')
  @ApiOperation({ summary: 'Find asset by fileId (service-to-service)' })
  @ApiResponse({ status: 200, type: AssetDto })
  @ApiResponse({ status: 404, description: 'Asset not found for this fileId' })
  async getByFileId(@Param('fileId') fileId: string) {
    return this.assets.getByFileId(fileId)
  }

  @Get('by-user/:userId')
  @ApiOperation({ summary: 'Get all assets for a user (service-to-service)' })
  @ApiResponse({ status: 200, type: [AssetDto] })
  async listByUser(@Param('userId') userId: string) {
    return this.assets.listByUser(userId)
  }

  @Patch(':id/metadata')
  @ApiOperation({ summary: 'Update extracted metadata (called by metadata process)' })
  @ApiResponse({ status: 200, type: AssetDto })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async updateMetadata(@Param('id') id: string, @Body() dto: UpdateMetadataDto) {
    return this.assets.updateMetadata(id, dto)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single asset' })
  @ApiResponse({ status: 200, description: 'Asset found', type: AssetDto })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getOne(@Param('id') id: string, @Query('userId') userId: string) {
    return this.assets.getOne(userId, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user-editable asset metadata' })
  @ApiResponse({ status: 200, description: 'Asset updated', type: AssetDto })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(dto.userId, id, dto)
  }

  @Post(':id/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete (trash) an asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async trash(@Param('id') id: string, @Query('userId') userId: string) {
    await this.assets.trash(userId, id)
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore a trashed asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset restored' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async restore(@Param('id') id: string, @Query('userId') userId: string) {
    await this.assets.restore(userId, id)
  }
}
