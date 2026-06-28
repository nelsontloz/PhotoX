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
import { ProxyService } from '../proxy.service'
import { BullMqService } from '../../queue/bullmq.service'
import { UpdatePersonDto } from './dto/update-person.dto'
import { ReassignFacesDto } from './dto/reassign-faces.dto'
import { CoverPersonDto } from './dto/cover-person.dto'
import { SERVICE_URLS } from '@photox/shared-config'

@ApiTags('persons')
@Controller('api/v1/persons')
export class PersonsProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly bullmq: BullMqService,
  ) {}

  @Post('cluster')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger face clustering for the current user' })
  @ApiResponse({ status: 202, description: 'Cluster job queued' })
  async triggerCluster(@Req() req: Request) {
    const userId = (req.user as { id: string }).id
    const jobId = `cluster:${userId}:manual`
    await this.bullmq.getQueue('process-faces-cluster').add('cluster', { userId, reason: 'manual' }, { jobId })
    return { queued: true, jobId }
  }

  @Get()
  @ApiOperation({ summary: 'List persons' })
  @ApiResponse({ status: 200, description: 'Paginated person list' })
  async list(@Query() q: Record<string, string | undefined>, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: 'v1/persons',
      query: { ...q, userId: (req.user as { id: string }).id },
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
    return result.data
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single person' })
  @ApiResponse({ status: 200, description: 'Person found' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async getOne(@Param('id') id: string, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/persons/${id}`,
      query: { userId: (req.user as { id: string }).id },
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
    return result.data
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a person' })
  @ApiResponse({ status: 200, description: 'Person updated' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePersonDto,
    @Req() req: Request,
  ) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'PATCH',
      path: `v1/persons/${id}`,
      query: { userId: (req.user as { id: string }).id },
      body: dto,
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
    return result.data
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'Get distinct assets containing this person' })
  @ApiResponse({ status: 200, description: 'Person assets' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async getAssets(
    @Param('id') id: string,
    @Query() q: Record<string, string | undefined>,
    @Req() req: Request,
  ) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/persons/${id}/assets`,
      query: { ...q, userId: (req.user as { id: string }).id },
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
    return result.data
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reassign faces between persons' })
  @ApiResponse({ status: 200, description: 'Faces reassigned' })
  async reassign(
    @Param('id') id: string,
    @Body() dto: ReassignFacesDto,
    @Req() req: Request,
  ) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'POST',
      path: `v1/persons/${id}/reassign`,
      query: { userId: (req.user as { id: string }).id },
      body: dto,
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
    return result.data
  }

  @Patch(':id/cover')
  @ApiOperation({ summary: 'Set the cover face for a person' })
  @ApiResponse({ status: 200, description: 'Cover set' })
  @ApiResponse({ status: 404, description: 'Person or face not found' })
  async setCover(
    @Param('id') id: string,
    @Body() dto: CoverPersonDto,
    @Req() req: Request,
  ) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'PATCH',
      path: `v1/persons/${id}/cover`,
      body: { userId: (req.user as { id: string }).id, faceId: dto.faceId },
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
    return result.data
  }
}
