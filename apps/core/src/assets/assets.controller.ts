import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { AssetsService } from './assets.service'
import { CreateAssetDto } from './dto/create-asset.dto'
import { UpdateAssetDto } from './dto/update-asset.dto'
import { ListAssetsQueryDto } from './dto/list-assets-query.dto'
import { UpdateMetadataDto } from './dto/update-metadata.dto'
import { TrashAssetsDto } from './dto/trash-assets.dto'

@ApiTags('assets')
@Controller('api/v1/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an asset from an uploaded fileId' })
  @ApiResponse({ status: 201, description: 'Asset created' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async create(@Body() dto: CreateAssetDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id ?? dto.userId
    return this.assets.create(userId, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List assets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  async list(@Query() q: ListAssetsQueryDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id ?? q.userId
    return this.assets.list(userId, q)
  }

  @Get('by-file/:fileId')
  @ApiOperation({ summary: 'Find asset by fileId (service-to-service)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Asset not found for this fileId' })
  async getByFileId(@Param('fileId') fileId: string) {
    return this.assets.getByFileId(fileId)
  }

  @Patch(':id/metadata')
  @ApiOperation({ summary: 'Update extracted metadata (called by metadata process)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async updateMetadata(@Param('id') id: string, @Body() dto: UpdateMetadataDto) {
    return this.assets.updateMetadata(id, dto)
  }

  @Get('trashed')
  @ApiOperation({ summary: 'List trashed assets' })
  @ApiResponse({ status: 200, description: 'Paginated trashed asset list' })
  async listTrashed(@Query() q: ListAssetsQueryDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id ?? q.userId
    return this.assets.list(userId, { ...q, isTrashed: true })
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single asset' })
  @ApiResponse({ status: 200, description: 'Asset found' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getOne(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('userId') queryUserId?: string,
  ) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    return this.assets.getOne(userId, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user-editable asset metadata' })
  @ApiResponse({ status: 200, description: 'Asset updated' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateAssetDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id ?? dto.userId
    return this.assets.update(userId, id, dto)
  }

  @Post(':id/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete (trash) an asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async trash(@Param('id') id: string, @Req() req: Request, @Query('userId') queryUserId?: string) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    await this.assets.trash(userId, id)
  }

  @Post('bulk-trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bulk soft-delete (trash) assets. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Assets trashed' })
  async bulkTrash(
    @Body() dto: TrashAssetsDto,
    @Req() req: Request,
    @Query('userId') queryUserId?: string,
  ) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    await this.assets.bulkTrash(userId, dto.assetIds)
  }
}
