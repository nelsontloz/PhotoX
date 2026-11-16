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
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { PersonsService } from './persons.service';
import { BullMqService } from '../queue/bullmq.service';
import { UpdatePersonDto } from './dto/update-person.dto';
import { PaginationQueryDto } from '../common/pagination-query.dto';
import type { PersonListResponse, PersonDto } from '@photox/shared-types';
import {
  PersonClusterResponseModel,
  PersonClusterStatusModel,
  PersonListResponseModel,
  PersonModel,
} from '../swagger/response-models';

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
  @ApiResponse({ status: 202, description: 'Cluster job queued', type: PersonClusterResponseModel })
  async triggerCluster(@CurrentUserId() userId: string) {
    // ponytail: unique jobId per click — fixed jobId would dedupe via BullMQ and silently drop re-runs
    const jobId = `cluster-${userId}-manual-${Date.now()}`;
    await this.bullmq.enqueue(
      'process-faces-cluster',
      'cluster',
      { userId, reason: 'manual' },
      { jobId },
    );
    return { queued: true, jobId };
  }

  // The 202 above hands back a jobId; this is the route that makes it readable.
  @Get('cluster/:jobId')
  @ApiOperation({ summary: 'State of one queued face-cluster job' })
  @ApiResponse({ status: 200, description: 'Job state', type: PersonClusterStatusModel })
  @ApiResponse({ status: 404, description: 'Job not found (finished jobs are removed)' })
  async clusterStatus(@Param('jobId') jobId: string): Promise<{ jobId: string; state: string }> {
    const job = await this.bullmq.getQueue('process-faces-cluster').getJob(jobId);
    if (!job) throw new NotFoundException('Cluster job not found');
    return { jobId, state: await job.getState() };
  }

  @Get()
  @ApiOperation({ summary: 'List persons for a user' })
  @ApiResponse({ status: 200, description: 'Paginated person list', type: PersonListResponseModel })
  async list(
    @Query() q: PaginationQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<PersonListResponse> {
    return this.persons.list(userId, q.limit, q.offset);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single person' })
  @ApiResponse({ status: 200, description: 'Person found', type: PersonModel })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() userId: string,
  ): Promise<PersonDto> {
    return this.persons.getOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a person' })
  @ApiResponse({ status: 200, description: 'Person updated', type: PersonModel })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() userId: string,
    @Body() dto: UpdatePersonDto,
  ): Promise<PersonDto> {
    return this.persons.update(userId, id, dto.name);
  }
}
