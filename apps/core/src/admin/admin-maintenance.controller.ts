import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { FaceDetectionSettings } from '@photox/shared-types';
import { SettingsService } from '../settings/settings.service';
import { AdminAssetsService } from './admin-assets.service';
import { AdminJobsService } from './admin-jobs.service';
import {
  CleanupOrphansResponseModel,
  FaceDetectionSettingsModel,
  OrphanCountsResponseModel,
  ReclusterResponseModel,
} from '../swagger/response-models';

/** Inline maintenance. The six bulk reprocess pipelines live in `ReprocessRunsController`. */
@ApiTags('admin')
@Controller('api/v1/admin')
export class AdminMaintenanceController {
  constructor(
    private readonly admin: AdminAssetsService,
    private readonly adminJobs: AdminJobsService,
    private readonly settings: SettingsService,
  ) {}

  @Get('orphan-counts')
  @ApiOperation({ summary: 'Count orphan files and thumbnail rows (admin-only)' })
  @ApiResponse({ status: 200, description: 'Orphan counts', type: OrphanCountsResponseModel })
  async orphanCounts(): Promise<{ orphanFiles: number; orphanThumbnails: number }> {
    return this.admin.getOrphanCounts();
  }

  @Post('cleanup-orphans')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run orphan cleanup inline (admin-only)' })
  @ApiResponse({
    status: 200,
    description: 'Deleted orphan file, thumbnail and stray counts',
    type: CleanupOrphansResponseModel,
  })
  async cleanupOrphans(): Promise<{
    deletedFiles: number;
    deletedThumbnails: number;
    deletedStrays: number;
  }> {
    return this.admin.cleanupOrphans();
  }

  @Get('face-detection')
  @ApiOperation({ summary: 'SCRFD face-detector model availability (admin-only)' })
  @ApiResponse({
    status: 200,
    description: 'Current face detection settings',
    type: FaceDetectionSettingsModel,
  })
  async faceDetectionSettings(): Promise<FaceDetectionSettings> {
    return this.settings.getSettings();
  }

  @Post('faces/recluster')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue a manual face cluster job per distinct user with faces' })
  @ApiResponse({
    status: 200,
    description: 'One cluster job enqueued per distinct user with faces',
    type: ReclusterResponseModel,
  })
  async reclusterFaces(): Promise<{ enqueued: number }> {
    return this.adminJobs.reclusterFaces();
  }
}
