import { Controller, Get, Query, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { CurrentUser, type CurrentUser as CurrentUserType } from '../../auth/current-user.decorator'
import { AssetListOrchestrator } from './asset-list.orchestrator'

@ApiTags('flows.assets')
@Controller('api/v1/assets')
export class AssetListController {
  constructor(private readonly orchestrator: AssetListOrchestrator) {}

  @Get()
  @ApiOperation({ summary: 'List assets with signed download URLs' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  async list(
    @Query() query: { limit?: string; offset?: string },
    @CurrentUser() user: CurrentUserType,
    @Req() req: Request,
  ) {
    return this.orchestrator.list(user, (req.headers['x-request-id'] as string) ?? '', query)
  }
}
