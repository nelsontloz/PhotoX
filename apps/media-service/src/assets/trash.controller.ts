import {
  Controller,
  Body,
  Delete,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { AssetsService } from './assets.service'
import { TrashAssetsDto } from './dto/trash-assets.dto'
import { ListAssetsQueryDto } from './dto/list-assets-query.dto'

@ApiTags('assets')
@Controller('v1/assets')
export class TrashController {
  constructor(private readonly assets: AssetsService) {}

  @Get('trashed')
  @ApiOperation({ summary: 'List trashed assets' })
  @ApiResponse({ status: 200, description: 'Paginated trashed asset list' })
  async listTrashed(@Query() q: ListAssetsQueryDto) {
    return this.assets.list(q.userId, { ...q, isTrashed: true })
  }

  @Post('bulk-trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bulk soft-delete (trash) assets. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Assets trashed' })
  async bulkTrash(@Body() dto: TrashAssetsDto, @Query('userId') userId: string) {
    await this.assets.bulkTrash(userId, dto.assetIds)
  }

  @Delete('trashed')
  @ApiOperation({ summary: 'Permanently delete all trashed assets. Returns file IDs for cleanup.' })
  @ApiResponse({ status: 200, description: 'Trash emptied' })
  async emptyTrash(@Query('userId') userId: string) {
    return this.assets.emptyTrash(userId)
  }

  @Delete('trashed/:id')
  @ApiOperation({ summary: 'Permanently delete a trashed asset. Returns file IDs for cleanup.' })
  @ApiResponse({ status: 200, description: 'Asset deleted' })
  @ApiResponse({ status: 400, description: 'Asset is not trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async delete(@Param('id') id: string, @Query('userId') userId: string) {
    return this.assets.delete(userId, id)
  }

  @Post('trashed/:id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore a trashed asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset restored' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async restore(@Param('id') id: string, @Query('userId') userId: string) {
    await this.assets.restore(userId, id)
  }
}
