import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AssetDetectionsResponse } from '@photox/shared-types';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { DetectionsService } from './detections.service';

@ApiTags('detections')
@Controller('api/v1/assets')
export class DetectionsController {
  constructor(private readonly detections: DetectionsService) {}

  @Get(':id/detections')
  @ApiOperation({ summary: 'List detected objects for an asset (viewer overlay)' })
  @ApiResponse({ status: 200, description: 'Detections ordered by confidence desc' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async listDetections(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<AssetDetectionsResponse> {
    return this.detections.list(userId, id);
  }
}
