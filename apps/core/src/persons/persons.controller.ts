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
import { PersonsService } from './persons.service'
import { BullMqService } from '../queue/bullmq.service'
import { UpdatePersonDto } from './dto/update-person.dto'
import { ApplyClustersDto } from './dto/apply-clusters.dto'
import { ListPersonsQueryDto } from './dto/list-persons-query.dto'
import type { PersonListResponse, PersonDto, PersonAssetsResponse } from '@photox/shared-types'

@ApiTags('persons')
@Controller('api/v1/persons')
export class PersonsController {
  constructor(
    private readonly persons: PersonsService,
    private readonly bullmq: BullMqService,
  ) {}

  @Post('cluster')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger face clustering for the current user' })
  @ApiResponse({ status: 202, description: 'Cluster job queued' })
  async triggerCluster(@Req() req: Request) {
    const userId = (req.user as { id: string }).id
    // ponytail: unique jobId per click — fixed jobId would dedupe via BullMQ and silently drop re-runs
    const jobId = `cluster-${userId}-manual-${Date.now()}`
    await this.bullmq.enqueue(
      'process-faces-cluster',
      'cluster',
      { userId, reason: 'manual' },
      { jobId },
    )
    return { queued: true, jobId }
  }

  @Post('apply-clusters')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply a face clustering plan (create persons, assign faces, set covers)',
  })
  @ApiResponse({ status: 200, description: 'Plan applied' })
  @ApiResponse({ status: 400, description: 'Invalid plan (cover not in faceIds, too many faces)' })
  @ApiResponse({ status: 404, description: 'Face or person not found' })
  async applyClusters(@Req() req: Request, @Body() dto: ApplyClustersDto) {
    return this.persons.applyClusters((req.user as { id: string }).id, dto)
  }

  @Post('prune-empty')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete persons with no live faces (post-clustering cleanup)' })
  @ApiResponse({ status: 200, description: 'Empty persons deleted' })
  async pruneEmpty(@Req() req: Request): Promise<{ deleted: number }> {
    return this.persons.pruneEmpty((req.user as { id: string }).id)
  }

  @Get()
  @ApiOperation({ summary: 'List persons for a user' })
  @ApiResponse({ status: 200, description: 'Paginated person list' })
  async list(@Query() q: ListPersonsQueryDto, @Req() req: Request): Promise<PersonListResponse> {
    return this.persons.list((req.user as { id: string }).id, q.limit ?? 20, q.offset ?? 0)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single person' })
  @ApiResponse({ status: 200, description: 'Person found' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async getOne(@Param('id') id: string, @Req() req: Request): Promise<PersonDto> {
    return this.persons.getOne((req.user as { id: string }).id, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a person' })
  @ApiResponse({ status: 200, description: 'Person updated' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async update(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() dto: UpdatePersonDto,
  ): Promise<PersonDto> {
    return this.persons.update((req.user as { id: string }).id, id, dto.name)
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'Get distinct assets containing this person' })
  @ApiResponse({ status: 200, description: 'Person assets' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async getAssets(
    @Param('id') id: string,
    @Query() q: ListPersonsQueryDto,
    @Req() req: Request,
  ): Promise<PersonAssetsResponse> {
    return this.persons.getAssetsForPerson(
      (req.user as { id: string }).id,
      id,
      q.limit ?? 20,
      q.offset ?? 0,
    )
  }
}
