import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiProperty,
  ApiPropertyOptional,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types';
import { setResourceLocation } from '../common/resource-headers';
import { AdminJobsService } from './admin-jobs.service';
import {
  ReprocessRunStartResponseModel,
  ReprocessRunStatusResponseModel,
} from '../swagger/response-models';

/** Every pipeline that can be re-run in bulk. One resource, one `kind` field. */
const RUN_KINDS = [
  'faces',
  'embeddings',
  'detections',
  'metadata',
  'places',
  'thumbnails',
] as const;
type RunKind = (typeof RUN_KINDS)[number];

/** The stored last-run records are per-pipeline; only their names differ. */
const LAST_RUN_KIND = {
  faces: 'face',
  embeddings: 'embedding',
  detections: 'detections',
  metadata: 'metadata',
} as const;

class StartReprocessRunDto {
  @ApiProperty({ enum: RUN_KINDS })
  @IsIn(RUN_KINDS)
  kind!: RunKind;

  // Thumbnails are re-run per asset kind; every other pipeline covers its own candidate set.
  @ApiPropertyOptional({ enum: ['photo', 'video'], description: 'Required for kind=thumbnails' })
  @IsOptional()
  @IsIn(['photo', 'video'])
  assetKind?: 'photo' | 'video';
}

class ReprocessRunKindParamsDto {
  @ApiProperty({ enum: RUN_KINDS })
  @IsIn(RUN_KINDS)
  kind!: RunKind;
}

interface ReprocessRunStartResponse {
  kind: RunKind;
  enqueued: number;
  total: number;
  model?: string;
}

interface ReprocessRunStatusResponse {
  kind: RunKind;
  lastRun: object | null;
  queue?: Record<string, number>;
}

/**
 * One resource for "re-run a pipeline over the library", replacing the six POST/GET pairs under
 * `/admin/{faces,embeddings,detections,metadata,places/backfill,thumbnails}` (deprecated, see
 * `common/deprecations.ts`). The work is still the per-pipeline service call; this only gives the
 * six of them one address, one body shape and a status route a 202 can point at.
 */
@ApiTags('admin')
@Controller('api/v1/admin/reprocess-runs')
export class ReprocessRunsController {
  constructor(private readonly adminJobs: AdminJobsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start a bulk reprocess run for one pipeline (admin-only)',
    description:
      'Enqueues the work and answers 202 with the run counts. `Location` points at the status ' +
      'route, which reports the last recorded run and the live queue depth while it drains.',
  })
  @ApiResponse({
    status: 202,
    description: 'Run started; counts of jobs enqueued',
    type: ReprocessRunStartResponseModel,
  })
  @ApiResponse({ status: 400, description: 'Invalid kind, or thumbnails without assetKind' })
  async start(
    @Body() body: StartReprocessRunDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReprocessRunStartResponse> {
    const result = await this.startRun(body.kind, body.assetKind);
    setResourceLocation(res, `/api/v1/admin/reprocess-runs/${body.kind}`, 5);
    return result;
  }

  @Get(':kind')
  @ApiOperation({
    summary: 'Last recorded run and live queue depth for one pipeline (admin-only)',
    description: '`queue` is absent for pipelines that run inline (places, thumbnails).',
  })
  @ApiResponse({
    status: 200,
    description: 'Pipeline status',
    type: ReprocessRunStatusResponseModel,
  })
  @ApiResponse({ status: 400, description: 'Invalid kind' })
  async status(@Param() params: ReprocessRunKindParamsDto): Promise<ReprocessRunStatusResponse> {
    const { kind } = params;
    if (kind === 'places') {
      const { lastRun } = await this.adminJobs.placesStatus();
      return { kind, lastRun };
    }
    if (kind === 'thumbnails') return { kind, lastRun: null };
    const { lastRun, queue } = await this.adminJobs.status(LAST_RUN_KIND[kind]);
    return { kind, lastRun, queue };
  }

  private async startRun(
    kind: RunKind,
    assetKind: 'photo' | 'video' | undefined,
  ): Promise<ReprocessRunStartResponse> {
    switch (kind) {
      case 'faces': {
        const { enqueued, total } = await this.adminJobs.reprocessFaces();
        return { kind, enqueued, total };
      }
      case 'embeddings': {
        const { enqueued, total } = await this.adminJobs.reprocessEmbeddings();
        return { kind, enqueued, total, model: SEARCH_EMBEDDING_MODEL };
      }
      case 'detections': {
        const { enqueued, total } = await this.adminJobs.reprocessDetections();
        return { kind, enqueued, total };
      }
      case 'metadata': {
        const { enqueued, total } = await this.adminJobs.reprocessMetadata();
        return { kind, enqueued, total };
      }
      case 'places': {
        // inline resolution: `updated` is the enqueued equivalent for this pipeline
        const { updated, total } = await this.adminJobs.backfillPlaces();
        return { kind, enqueued: updated, total };
      }
      case 'thumbnails': {
        if (assetKind === undefined) {
          throw new BadRequestException('assetKind is required when kind=thumbnails');
        }
        const { enqueued, total } = await this.adminJobs.reprocessThumbnails(assetKind);
        return { kind, enqueued, total };
      }
    }
  }
}
