import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { AssetsService } from './assets.service'
import { UserIdGuard } from './user-id.guard'
import { AssetDto } from './dto/asset.dto'
import { CreateAssetDto } from './dto/create-asset.dto'
import { UpdateAssetDto } from './dto/update-asset.dto'
import { ListAssetsQueryDto } from './dto/list-assets-query.dto'
import { AssetListResponseDto } from './dto/asset-list-response.dto'

@ApiTags('assets')
@Controller('v1/assets')
@UseGuards(UserIdGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an asset from an uploaded fileId' })
  @ApiResponse({ status: 201, description: 'Asset created', type: AssetDto })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async create(@Req() req: Request, @Body() dto: CreateAssetDto) {
    return this.assets.create(req.userId!, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List assets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated asset list', type: AssetListResponseDto })
  async list(@Req() req: Request, @Query() q: ListAssetsQueryDto) {
    return this.assets.list(req.userId!, q)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single asset' })
  @ApiResponse({ status: 200, description: 'Asset found', type: AssetDto })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getOne(@Req() req: Request, @Param('id') id: string) {
    return this.assets.getOne(req.userId!, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user-editable asset metadata' })
  @ApiResponse({ status: 200, description: 'Asset updated', type: AssetDto })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(req.userId!, id, dto)
  }

  @Post(':id/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete (trash) an asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async trash(@Req() req: Request, @Param('id') id: string) {
    await this.assets.trash(req.userId!, id)
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore a trashed asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset restored' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async restore(@Req() req: Request, @Param('id') id: string) {
    await this.assets.restore(req.userId!, id)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete an asset (purge). Cascades to file-storage.' })
  @ApiResponse({ status: 204, description: 'Asset purged' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  @ApiResponse({ status: 502, description: 'File storage delete failed' })
  async purge(@Req() req: Request, @Param('id') id: string) {
    await this.assets.purge(req.userId!, id)
  }
}
