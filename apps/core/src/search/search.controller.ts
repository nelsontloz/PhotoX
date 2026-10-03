import { Controller, Get, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import type { SearchResponse } from '@photox/shared-types'
import { SearchService } from './search.service'
import { SearchQueryDto } from './dto/search-query.dto'

@ApiTags('search')
@Controller('api/v1/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Hybrid semantic + full-text search over the caller’s own assets' })
  @ApiResponse({
    status: 200,
    description: 'Ranked page of assets (identical item shape to GET /api/v1/assets)',
  })
  @ApiResponse({ status: 400, description: 'Invalid q/limit/offset' })
  @ApiResponse({ status: 503, description: 'Vision search model not provisioned' })
  async query(@Query() dto: SearchQueryDto, @Req() req: Request): Promise<SearchResponse> {
    return this.search.search((req.user as { id: string }).id, dto)
  }
}
