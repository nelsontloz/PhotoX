import { Controller, Get, Param, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { CurrentUser, type CurrentUser as CurrentUserType } from '../../auth/current-user.decorator'
import { AssetDetailOrchestrator } from './asset-detail.orchestrator'

@ApiTags('flows.assets')
@Controller('api/v1/assets')
export class AssetDetailController {
  constructor(private readonly orchestrator: AssetDetailOrchestrator) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get asset detail with thumbnails and signed URL' })
  @ApiResponse({ status: 200, description: 'Asset with thumbnails' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async detail(@Param('id') id: string, @CurrentUser() user: CurrentUserType, @Req() req: Request) {
    return this.orchestrator.detail(user, (req.headers['x-request-id'] as string) ?? '', id)
  }
}
