import { Controller, Get, Param, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import type { SearchResponse } from '@photox/shared-types'
import { GroupsService } from './groups.service'
import { DuplicatesQueryDto, SimilarQueryDto } from './dto/groups-query.dto'

@ApiTags('groups')
@Controller('api/v1')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get('assets/:id/duplicates')
  @ApiOperation({ summary: 'Find perceptual duplicates of an asset within a Hamming threshold' })
  @ApiResponse({ status: 200, description: 'Duplicate assets ordered by Hamming distance asc' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async duplicates(
    @Param('id') id: string,
    @Query() dto: DuplicatesQueryDto,
    @Req() req: Request,
  ): Promise<SearchResponse> {
    return this.groups.duplicates((req.user as { id: string }).id, id, dto)
  }

  @Get('assets/:id/similar')
  @ApiOperation({ summary: 'Find visually similar assets via image-embedding ANN' })
  @ApiResponse({
    status: 200,
    description: 'Similar assets (empty when the asset has no embedding)',
  })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async similar(
    @Param('id') id: string,
    @Query() dto: SimilarQueryDto,
    @Req() req: Request,
  ): Promise<SearchResponse> {
    return this.groups.similar((req.user as { id: string }).id, id, dto)
  }
}
