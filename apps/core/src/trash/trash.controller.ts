import { Controller, Delete, Post, Param, Req, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { AssetsService } from '../assets/assets.service'

@ApiTags('trashed')
@Controller('api/v1/assets')
export class TrashController {
  constructor(private readonly assets: AssetsService) {}

  @Delete('trashed')
  @ApiOperation({ summary: 'Permanently delete all trashed assets. Returns file IDs for cleanup.' })
  @ApiResponse({ status: 200, description: 'Trash emptied' })
  async emptyTrash(@Req() req: Request) {
    return this.assets.emptyTrash((req.user as { id: string }).id)
  }

  @Delete('trashed/:id')
  @ApiOperation({ summary: 'Permanently delete a trashed asset. Returns file IDs for cleanup.' })
  @ApiResponse({ status: 200, description: 'Asset deleted' })
  @ApiResponse({ status: 400, description: 'Asset is not trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async delete(@Param('id') id: string, @Req() req: Request) {
    return this.assets.delete((req.user as { id: string }).id, id)
  }

  @Post('trashed/:id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore a trashed asset. Idempotent.' })
  @ApiResponse({ status: 204, description: 'Asset restored' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async restore(@Param('id') id: string, @Req() req: Request) {
    await this.assets.restore((req.user as { id: string }).id, id)
  }
}
